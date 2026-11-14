//! Sandbox-only: real NEP-141 mechanics and explicitly Simulated Pyth prices.
//! Never deploy as a production token or oracle.
use near_contract_standards::{
    fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver},
    storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement},
};
use near_sdk::{
    env,
    json_types::U128,
    near, require,
    serde_json::{json, Value},
    AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
use std::collections::BTreeMap;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Fixture {
    owner_id: AccountId,
    token: FungibleToken,
    prices: BTreeMap<String, String>,
    ages: BTreeMap<String, u64>,
    pause_target: Option<AccountId>,
    pause_sent: bool,
    guardian_fixture: Option<String>,
}
#[near]
impl Fixture {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self {
            owner_id,
            token: FungibleToken::new(b"t".to_vec()),
            prices: BTreeMap::new(),
            ages: BTreeMap::new(),
            pause_target: None,
            pause_sent: false,
            guardian_fixture: None,
        }
    }
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Fixture owner only"
        );
        self.token.internal_deposit(&account_id, amount.0);
    }
    pub fn set_price(&mut self, price_id: String, price: String) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Fixture owner only"
        );
        require!(price.parse::<u64>().is_ok(), "Invalid simulated price");
        self.prices.insert(price_id, price);
    }
    pub fn get_price_no_older_than(
        &mut self,
        price_id: String,
        age: u64,
    ) -> PromiseOrValue<Option<Value>> {
        if age == 0 {
            return PromiseOrValue::Value(None);
        }
        let time = (env::block_timestamp() / 1_000_000_000)
            .saturating_sub(*self.ages.get(&price_id).unwrap_or(&0));
        let value = self
            .prices
            .get(&price_id)
            .map(|p| json!({"price":p,"conf":"0","expo":-8,"publish_time":time}));
        if !self.pause_sent {
            if let Some(target) = &self.pause_target {
                self.pause_sent = true;
                return PromiseOrValue::Promise(
                    Promise::new(target.clone())
                        .function_call_weight(
                            "pause",
                            b"{}".to_vec(),
                            NearToken::from_yoctonear(1),
                            Gas::from_tgas(2),
                            GasWeight(0),
                        )
                        .then(
                            Self::ext(env::current_account_id())
                                .with_static_gas(Gas::from_tgas(2))
                                .with_unused_gas_weight(0)
                                .on_fixture_price(value),
                        ),
                );
            }
        }
        PromiseOrValue::Value(value)
    }

    #[private]
    pub fn on_fixture_price(&self, value: Option<Value>) -> Option<Value> {
        value
    }

    /// Deterministic owner pause during Guardian's price read, sandbox only.
    pub fn set_pause_target(&mut self, target: Option<AccountId>) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Fixture owner only"
        );
        self.pause_target = target;
        self.pause_sent = false;
    }

    pub fn send_fixture_tokens(
        &self,
        token: AccountId,
        receiver: AccountId,
        amount: U128,
        msg: String,
    ) -> Promise {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Fixture owner only"
        );
        Promise::new(token).function_call(
            "ft_transfer_call",
            near_sdk::serde_json::to_vec(
                &json!({"receiver_id":receiver,"amount":amount,"msg":msg}),
            )
            .unwrap(),
            NearToken::from_yoctonear(1),
            Gas::from_tgas(50),
        )
    }

    pub fn clear_price(&mut self, price_id: String) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Fixture owner only"
        );
        self.prices.remove(&price_id);
    }

    /// Intentionally return an expired reply even through no_older_than so the
    /// probe must independently enforce freshness, rather than trust the oracle.
    pub fn set_price_age(&mut self, price_id: String, age_sec: u64) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Fixture owner only"
        );
        self.ages.insert(price_id, age_sec);
    }

    /// Deployed Rhea testnet 0.11.0 uses the older Pyth interface.
    pub fn get_price(&mut self, price_identifier: String) -> PromiseOrValue<Option<Value>> {
        self.get_price_no_older_than(price_identifier, 60)
    }

    /// Deliberate partial/full-refund receiver for recorded NEP-141 fixtures.
    /// This is not a Rhea repayment implementation.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        if let Some(config) = &self.guardian_fixture {
            let config: Value = near_sdk::serde_json::from_str(config).unwrap();
            require!(
                sender_id.as_str() == config["guardian"].as_str().unwrap()
                    && env::predecessor_account_id().as_str() == config["debt"].as_str().unwrap(),
                "Fixture Guardian/token mismatch"
            );
            let expected = if config["version"] == "0.16.2" {
                "\"OnlyRepay\"".to_owned()
            } else {
                json!({"Execute":{"actions":[{"Repay":{"token_id":config["debt"],"max_amount":amount.0.to_string()}}]}}).to_string()
            };
            require!(msg == expected, "Unexpected fixture encoding");
            return U128(amount.0 * config["refund_percent"].as_u64().unwrap() as u128 / 100);
        }
        require!(sender_id == self.owner_id, "Fixture owner only");
        require!(msg == "\"OnlyRepay\"", "Intentional fixture rejection");
        U128(amount.0 / 2)
    }

    /// Controlled refund/position fixture, never imported-Rhea evidence.
    pub fn set_guardian_fixture(&mut self, config: Value) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Fixture owner only"
        );
        self.guardian_fixture = Some(config.to_string());
    }
    pub fn get_version(&self) -> String {
        self.fixture_config()["version"].as_str().unwrap().into()
    }
    pub fn get_config(&self) -> Value {
        json!({"pyth_oracle_account_id":env::current_account_id(),"pyth_price_valid_duration_sec":60,"enable_pyth_oracle":true})
    }
    pub fn get_account(&self, account_id: AccountId) -> Value {
        let c = self.fixture_config();
        json!({"account_id":account_id,"collateral":[{"token_id":c["collateral"],"balance":"100000000"}],"borrowed":[{"token_id":c["debt"],"balance":"1000000000"}],"supplied":[]})
    }
    pub fn get_assets(&self, token_ids: Vec<AccountId>) -> Value {
        let c = self.fixture_config();
        Value::Array(token_ids.into_iter().map(|token|json!({"token_id":token,"config":{"volatility_ratio":if token.as_str()==c["debt"].as_str().unwrap(){9500}else{6000},"extra_decimals":0}})).collect())
    }
    pub fn get_token_pyth_info(&self, token_id: AccountId) -> Value {
        let c = self.fixture_config();
        json!({"price_identifier":if token_id.as_str()==c["debt"].as_str().unwrap(){"22".repeat(32)}else{"11".repeat(32)},"decimals":6,"fraction_digits":4,"extra_call":null,"default_price":null})
    }
}
impl Fixture {
    fn fixture_config(&self) -> Value {
        near_sdk::serde_json::from_str(
            self.guardian_fixture
                .as_ref()
                .expect("Fixture not configured"),
        )
        .unwrap()
    }
}
#[near]
impl FungibleTokenCore for Fixture {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }
    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }
    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }
    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}
#[near]
impl FungibleTokenResolver for Fixture {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .internal_ft_resolve_transfer(&sender_id, receiver_id, amount)
            .0
            .into()
    }
}
#[near]
impl StorageManagement for Fixture {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}
