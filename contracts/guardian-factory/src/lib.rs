//! Keyless per-owner Guardian factory (P2.6, D18 G1).
//!
//! Permission boundary: anyone may create a Guardian for themselves (the
//! predecessor becomes the owner) by attaching NEAR inside the configured bounds.
//! The Guardian code is this contract's own embedded bytes, the config comes from
//! the immutable template, and the child account gets no access key. The factory
//! has no method that reaches an existing Guardian and no code setter.
//!
//! Invariant: I10 (no access keys, no upgrade path) holds by construction because
//! creation is one batch of create-account, transfer, deploy and `new`. That batch
//! is atomic: a failure leaves no child and the whole deposit returns to this
//! factory, which forwards it to the owner. The owner mapping is written only
//! after the batch succeeded.
//!
//! Does not guarantee: that a refund covers gas, that a Guardian can be recovered
//! or upgraded after creation, or that the deposit can be taken back from the
//! keyless child.
use guardian_types::{GuardianConfig, Policy};
use near_sdk::{
    assert_one_yocto, env,
    json_types::U128,
    near, require,
    serde_json::{self, json},
    store::{LookupMap, LookupSet},
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};

/// The prepared Guardian build; empty when the artifact has not been prepared.
const GUARDIAN_CODE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/guardian.wasm"));
/// Hex characters of the derived label: 128 bits, collision resistant.
const LABEL_LEN: usize = 32;
const MAX_ACCOUNT_ID_LEN: usize = 64;
const CREATE_GAS: u64 = 100;
const CHILD_INIT_GAS: u64 = 30;
const CALLBACK_GAS: u64 = 25;
const FOLLOW_UP_GAS: u64 = 10;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Nonce,
    Pending,
    Latest,
    Created,
    Unclaimed,
}

/// Every `GuardianConfig` field except the owner, fixed at factory initialization.
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct GuardianTemplate {
    pub watcher_id: AccountId,
    pub lending_id: AccountId,
    pub oracle_id: AccountId,
    pub debt_token_id: AccountId,
    pub collateral_token_id: AccountId,
    pub fee_recipient_id: AccountId,
    pub activation_fee: U128,
    pub lending_version: String,
    pub debt_extra_decimals: u8,
    pub collateral_extra_decimals: u8,
    pub collateral_price_id: String,
    pub debt_price_id: String,
    pub max_price_age_sec: u32,
}

impl GuardianTemplate {
    fn config_for(&self, owner_id: AccountId) -> GuardianConfig {
        GuardianConfig {
            owner_id,
            watcher_id: self.watcher_id.clone(),
            lending_id: self.lending_id.clone(),
            oracle_id: self.oracle_id.clone(),
            debt_token_id: self.debt_token_id.clone(),
            collateral_token_ids: vec![self.collateral_token_id.clone()],
            fee_recipient_id: self.fee_recipient_id.clone(),
            activation_fee: self.activation_fee,
            lending_version: self.lending_version.clone(),
            debt_extra_decimals: self.debt_extra_decimals,
            collateral_extra_decimals: self.collateral_extra_decimals,
            collateral_price_id: self.collateral_price_id.clone(),
            debt_price_id: self.debt_price_id.clone(),
            max_price_age_sec: self.max_price_age_sec,
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RefundStatus {
    Sent,
    Claimable,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum CreateOutcome {
    Created {
        guardian_id: AccountId,
        owner_id: AccountId,
    },
    /// The batch reverted atomically: no child exists. `refund` says whether the
    /// deposit reached the owner or waits in `claim_refund`. Gas is never refunded.
    Failed {
        phase: String,
        refund: RefundStatus,
        amount: U128,
    },
}

#[near(serializers = [json])]
pub struct Limits {
    pub min_funding: U128,
    pub max_funding: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct GuardianFactory {
    template: GuardianTemplate,
    min_funding: u128,
    max_funding: u128,
    nonce: LookupMap<AccountId, u32>,
    pending: LookupSet<AccountId>,
    latest: LookupMap<AccountId, AccountId>,
    created: LookupMap<AccountId, AccountId>,
    unclaimed: LookupMap<AccountId, u128>,
}

#[near]
impl GuardianFactory {
    #[init]
    pub fn new(template: GuardianTemplate, min_funding: U128, max_funding: U128) -> Self {
        require!(
            template.collateral_token_id != template.debt_token_id,
            "Exactly one distinct collateral required"
        );
        // Same rules the Guardian applies to its own config.
        template.config_for(env::current_account_id()).validate();
        require!(
            LABEL_LEN + 1 + env::current_account_id().as_str().len() <= MAX_ACCOUNT_ID_LEN,
            "Factory account id too long for child ids"
        );
        require!(
            min_funding.0 >= Self::storage_floor() && max_funding.0 >= min_funding.0,
            "Funding bounds below the code storage cost"
        );
        Self {
            template,
            min_funding: min_funding.0,
            max_funding: max_funding.0,
            nonce: LookupMap::new(StorageKey::Nonce),
            pending: LookupSet::new(StorageKey::Pending),
            latest: LookupMap::new(StorageKey::Latest),
            created: LookupMap::new(StorageKey::Created),
            unclaimed: LookupMap::new(StorageKey::Unclaimed),
        }
    }

    /// Create the caller's Guardian. The attached deposit becomes the child's balance.
    #[payable]
    pub fn create_guardian(&mut self, policy: Policy) -> Promise {
        require!(!GUARDIAN_CODE.is_empty(), "Guardian code not prepared");
        let owner_id = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        // Panics refund the attached deposit to the caller automatically.
        require!(
            (self.min_funding..=self.max_funding).contains(&deposit),
            "Funding outside the allowed range"
        );
        require!(
            env::prepaid_gas() >= Gas::from_tgas(CREATE_GAS + CALLBACK_GAS + 2 * FOLLOW_UP_GAS),
            "More gas required"
        );
        require!(!self.pending.contains(&owner_id), "Creation in flight");
        policy
            .validate()
            .unwrap_or_else(|reason| env::panic_str(reason));
        let guardian_id = self.next_guardian_id(owner_id.clone());
        let init = serde_json::to_vec(&json!({
            "config": self.template.config_for(owner_id.clone()),
            "policy": policy,
        }))
        .expect("JSON encoding");
        self.pending.insert(owner_id.clone());
        emit(
            "guardian_creation_started",
            json!({"owner_id":owner_id,"guardian_id":guardian_id,"deposit":U128(deposit)}),
        );
        Promise::new(guardian_id.clone())
            .create_account()
            .transfer(NearToken::from_yoctonear(deposit))
            .deploy_contract(GUARDIAN_CODE.to_vec())
            .function_call(
                "new",
                init,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(CHILD_INIT_GAS),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(CALLBACK_GAS))
                    .with_unused_gas_weight(0)
                    .on_guardian_created(owner_id, guardian_id, U128(deposit)),
            )
    }

    #[private]
    pub fn on_guardian_created(
        &mut self,
        owner_id: AccountId,
        guardian_id: AccountId,
        deposit: U128,
    ) -> PromiseOrValue<CreateOutcome> {
        // A replayed or foreign continuation finds nothing pending and fails.
        require!(self.pending.remove(&owner_id), "Creation not pending");
        let succeeded =
            env::promise_results_count() == 1 && env::promise_result_checked(0, 64).is_ok();
        if succeeded {
            let next = self.nonce.get(&owner_id).copied().unwrap_or(0);
            self.nonce.insert(
                owner_id.clone(),
                next.checked_add(1).expect("Nonce overflow"),
            );
            self.created.insert(guardian_id.clone(), owner_id.clone());
            self.latest.insert(owner_id.clone(), guardian_id.clone());
            emit(
                "guardian_created",
                json!({"owner_id":owner_id,"guardian_id":guardian_id}),
            );
            return PromiseOrValue::Value(CreateOutcome::Created {
                guardian_id,
                owner_id,
            });
        }
        // Atomic revert: no child, no mapping, the nonce stays so a retry reuses the id.
        emit(
            "guardian_creation_failed",
            json!({"owner_id":owner_id,"guardian_id":guardian_id,"amount":deposit}),
        );
        PromiseOrValue::Promise(
            Promise::new(owner_id.clone())
                .transfer(NearToken::from_yoctonear(deposit.0))
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(FOLLOW_UP_GAS))
                        .with_unused_gas_weight(0)
                        .on_refund_resolved(owner_id, deposit),
                ),
        )
    }

    #[private]
    pub fn on_refund_resolved(&mut self, owner_id: AccountId, amount: U128) -> CreateOutcome {
        let sent = env::promise_results_count() == 1 && env::promise_result_checked(0, 64).is_ok();
        if sent {
            emit("refund_sent", json!({"owner_id":owner_id,"amount":amount}));
        } else {
            self.credit(&owner_id, amount.0);
            emit(
                "refund_claimable",
                json!({"owner_id":owner_id,"amount":amount}),
            );
        }
        CreateOutcome::Failed {
            phase: "create_batch".into(),
            refund: if sent {
                RefundStatus::Sent
            } else {
                RefundStatus::Claimable
            },
            amount,
        }
    }

    /// Withdraw a refund whose automatic transfer failed.
    #[payable]
    pub fn claim_refund(&mut self) -> Promise {
        assert_one_yocto();
        let owner_id = env::predecessor_account_id();
        let amount = self
            .unclaimed
            .remove(&owner_id)
            .unwrap_or_else(|| env::panic_str("Nothing to claim"));
        Promise::new(owner_id.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(FOLLOW_UP_GAS))
                    .with_unused_gas_weight(0)
                    .on_claim_resolved(owner_id, U128(amount)),
            )
    }

    #[private]
    pub fn on_claim_resolved(&mut self, owner_id: AccountId, amount: U128) -> bool {
        if env::promise_results_count() == 1 && env::promise_result_checked(0, 64).is_ok() {
            emit(
                "refund_claimed",
                json!({"owner_id":owner_id,"amount":amount}),
            );
            return true;
        }
        self.credit(&owner_id, amount.0);
        false
    }

    pub fn get_guardian(&self, owner_id: AccountId) -> Option<AccountId> {
        self.latest.get(&owner_id).cloned()
    }
    pub fn get_owner(&self, guardian_id: AccountId) -> Option<AccountId> {
        self.created.get(&guardian_id).cloned()
    }
    /// The id the owner's next successful creation will use.
    pub fn get_next_guardian_id(&self, owner_id: AccountId) -> AccountId {
        self.next_guardian_id(owner_id)
    }
    pub fn get_template(&self) -> GuardianTemplate {
        self.template.clone()
    }
    pub fn get_limits(&self) -> Limits {
        Limits {
            min_funding: U128(self.min_funding),
            max_funding: U128(self.max_funding),
        }
    }
    pub fn get_unclaimed(&self, owner_id: AccountId) -> U128 {
        U128(self.unclaimed.get(&owner_id).copied().unwrap_or(0))
    }
    pub fn is_pending(&self, owner_id: AccountId) -> bool {
        self.pending.contains(&owner_id)
    }
    pub fn get_code_hash(&self) -> Vec<u8> {
        env::sha256(GUARDIAN_CODE)
    }
    pub fn get_code_len(&self) -> u64 {
        GUARDIAN_CODE.len() as u64
    }
}

impl GuardianFactory {
    /// Lower bound for any deposit: the embedded code's storage cost.
    fn storage_floor() -> u128 {
        (GUARDIAN_CODE.len() as u128) * env::storage_byte_cost().as_yoctonear()
    }
    fn next_guardian_id(&self, owner_id: AccountId) -> AccountId {
        let nonce = self.nonce.get(&owner_id).copied().unwrap_or(0);
        let mut input = owner_id.as_str().as_bytes().to_vec();
        input.extend_from_slice(&nonce.to_le_bytes());
        let label: String = env::sha256(&input)
            .iter()
            .take(LABEL_LEN / 2)
            .map(|byte| format!("{byte:02x}"))
            .collect();
        format!("{label}.{}", env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("Invalid child id"))
    }
    fn credit(&mut self, owner_id: &AccountId, amount: u128) {
        let total = self
            .unclaimed
            .get(owner_id)
            .copied()
            .unwrap_or(0)
            .checked_add(amount)
            .expect("Unclaimed overflow");
        self.unclaimed.insert(owner_id.clone(), total);
    }
}

fn emit(event: &str, mut data: serde_json::Value) {
    data["at_ns"] = json!(near_sdk::json_types::U64(env::block_timestamp()));
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard":"mrfund_guardian_factory","version":"1.0.0","event":event,"data":[data]})
    ));
}

#[cfg(test)]
mod tests;
