//! Throwaway Phase 0 probe (BUILD-PLAN P0.3, P0.4). Deleted at P6.2 unless reused.

mod composed;
mod trigger;

use near_sdk::{
    assert_one_yocto, env,
    json_types::U128,
    near, require,
    serde_json::{self, json},
    AccountId, Gas, NearToken, PanicOnDefault, Promise,
};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Probe {
    owner_id: AccountId,
    lending_id: AccountId,
    collateral_token_id: AccountId,
    debt_token_id: AccountId,
    debt_extra_decimals: u8,
    collateral_extra_decimals: u8,
    next_op_id: u64,
    in_flight: Option<u64>,
    last_result: Option<ProbeResult>,
    last_trigger_result: Option<trigger::TriggerResult>,
    composed: Option<composed::ComposedOperation>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct ProbeResult {
    pub op_id: u64,
    pub operation: String,
    /// Only the immediate promise result. Rhea may launch detached receipts;
    /// the harness must inspect every receipt AND read back position/token state.
    pub receipt_succeeded: bool,
    pub used: Option<U128>,
}

#[near]
impl Probe {
    #[init]
    pub fn new(
        owner_id: AccountId,
        lending_id: AccountId,
        collateral_token_id: AccountId,
        debt_token_id: AccountId,
        debt_extra_decimals: u8,
        collateral_extra_decimals: u8,
    ) -> Self {
        require!(
            debt_extra_decimals <= 38 && collateral_extra_decimals <= 38,
            "Invalid extra decimals"
        );
        require!(
            collateral_token_id != debt_token_id,
            "Distinct tokens required"
        );
        Self {
            owner_id,
            lending_id,
            collateral_token_id,
            debt_token_id,
            debt_extra_decimals,
            collateral_extra_decimals,
            next_op_id: 0,
            in_flight: None,
            last_result: None,
            last_trigger_result: None,
            composed: None,
        }
    }

    #[payable]
    pub fn probe_register(&mut self, target_id: AccountId, storage_deposit: U128) -> Promise {
        self.assert_owner();
        require!(
            target_id == self.lending_id
                || target_id == self.collateral_token_id
                || target_id == self.debt_token_id,
            "Unsupported registration target"
        );
        require!(storage_deposit.0 > 0, "Positive deposit required");
        self.run(
            "register",
            target_id,
            "storage_deposit",
            json!({"account_id":env::current_account_id(),"registration_only":true}),
            NearToken::from_yoctonear(storage_deposit.0),
            Gas::from_tgas(30),
        )
    }

    /// Fund the probe with the owner's configured token before invoking an operation.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let token = env::predecessor_account_id();
        if sender_id != self.owner_id
            || (token != self.collateral_token_id && token != self.debt_token_id)
            || !msg.is_empty()
        {
            return amount;
        }
        U128(0)
    }

    #[payable]
    pub fn probe_supply_collateral(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        let msg = serde_json::to_string(&json!({"Execute":{"actions":[{"IncreaseCollateral":{"token_id":self.collateral_token_id}}]}})).expect("JSON encoding");
        self.transfer(
            "supply_collateral",
            self.collateral_token_id.clone(),
            amount,
            msg,
        )
    }

    #[payable]
    pub fn probe_borrow(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        let internal = Self::internal(amount, self.debt_extra_decimals);
        self.execute("borrow", json!([{"Borrow":{"token_id":self.debt_token_id,"amount":internal}},{"Withdraw":{"token_id":self.debt_token_id,"amount":internal}}]))
    }

    #[payable]
    pub fn probe_repay(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        self.transfer(
            "repay",
            self.debt_token_id.clone(),
            amount,
            "\"OnlyRepay\"".to_string(),
        )
    }

    #[payable]
    pub fn probe_release(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        let internal = Self::internal(amount, self.collateral_extra_decimals);
        self.execute("release", json!([{"DecreaseCollateral":{"token_id":self.collateral_token_id,"amount":internal}},{"Withdraw":{"token_id":self.collateral_token_id,"amount":internal}}]))
    }

    /// Explicit legacy path for deployed testnet 0.11.0; never an automatic retry.
    #[payable]
    pub fn probe_repay_via_execute(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        let internal = Self::internal(amount, self.debt_extra_decimals);
        let msg = serde_json::to_string(&json!({"Execute":{"actions":[{"Repay":{"token_id":self.debt_token_id,"max_amount":internal}}]}})).expect("JSON encoding");
        self.transfer("repay_via_execute", self.debt_token_id.clone(), amount, msg)
    }

    #[private]
    pub fn on_result(&mut self, op_id: u64, operation: String) -> ProbeResult {
        require!(self.in_flight == Some(op_id), "Operation mismatch");
        require!(
            env::promise_results_count() == 1,
            "Expected one promise result"
        );
        let result = env::promise_result_checked(0, 4096);
        let transfer = operation == "repay"
            || operation == "repay_via_execute"
            || operation == "supply_collateral";
        let used = match &result {
            Ok(bytes) if transfer => serde_json::from_slice::<U128>(bytes).ok(),
            _ => None,
        };
        let record = ProbeResult {
            op_id,
            operation,
            receipt_succeeded: result.is_ok() && (!transfer || used.is_some()),
            used,
        };
        self.in_flight = None;
        self.last_result = Some(record.clone());
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({"standard":"mrfund_probe","version":"1.0.0","event":"operation_resolved","data":[record]})
        ));
        record
    }

    pub fn get_last_result(&self) -> Option<ProbeResult> {
        self.last_result.clone()
    }
}

impl Probe {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "Owner only");
        assert_one_yocto();
        require!(self.in_flight.is_none(), "Operation in flight");
    }
    fn internal(amount: U128, extra: u8) -> U128 {
        require!(amount.0 > 0, "Positive amount required");
        U128(
            amount
                .0
                .checked_mul(10u128.pow(extra.into()))
                .expect("Internal amount overflow"),
        )
    }
    fn execute(&mut self, operation: &str, actions: serde_json::Value) -> Promise {
        self.run(
            operation,
            self.lending_id.clone(),
            "execute_with_pyth",
            json!({"actions":actions}),
            NearToken::from_yoctonear(1),
            Gas::from_tgas(240),
        )
    }
    fn transfer(
        &mut self,
        operation: &str,
        token: AccountId,
        amount: U128,
        msg: String,
    ) -> Promise {
        require!(amount.0 > 0, "Positive amount required");
        self.run(
            operation,
            token,
            "ft_transfer_call",
            json!({"receiver_id":self.lending_id,"amount":amount,"memo":null,"msg":msg}),
            NearToken::from_yoctonear(1),
            Gas::from_tgas(240),
        )
    }
    fn run(
        &mut self,
        operation: &str,
        target: AccountId,
        method: &str,
        args: serde_json::Value,
        deposit: NearToken,
        gas: Gas,
    ) -> Promise {
        let op_id = self.next_op_id;
        self.next_op_id = self
            .next_op_id
            .checked_add(1)
            .expect("Operation id overflow");
        self.in_flight = Some(op_id);
        Promise::new(target)
            .function_call(
                method,
                serde_json::to_vec(&args).expect("JSON encoding"),
                deposit,
                gas,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(10))
                    .on_result(op_id, operation.into()),
            )
    }
}

#[cfg(test)]
mod tests;
