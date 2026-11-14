//! P2.4 owner position operations for a Guardian-held Rhea loan (D18 G1).
//!
//! Permission boundary: every mutating method needs the stored owner and exactly
//! 1 yocto, so a function-call key (the watcher's) can never reach it. Targets are
//! fixed to the configured lending contract and tokens. Every operation takes the
//! shared lock (`in_flight`) that settlement and reserve operations use, so none
//! can interleave. Callbacks are private and bound to the operation id and kind.
//!
//! Does not guarantee: that Rhea accepted an action beyond the immediate promise
//! result (detached receipts are verified by sandbox post-state reads), nor
//! liquidation protection.
use crate::{
    events,
    state::{InFlight, PositionOperation},
    Guardian, GuardianExt,
};
use near_sdk::{
    env,
    json_types::{U128, U64},
    near, require,
    serde_json::{self, json, Value},
    AccountId, Gas, NearToken, Promise, PromiseOrValue,
};

/// Rhea `execute_with_pyth` budget; the probe needed up to 240 Tgas.
const RHEA_EXECUTE_GAS: u64 = 240;
const CALLBACK_GAS: u64 = 10;
const COLLATERAL_TRANSFER_GAS: u64 = 100;
const MANUAL_REPAY_GAS: u64 = 85;

#[near]
impl Guardian {
    /// Register this account with a configured counterparty, paying its storage
    /// deposit from the Guardian's own NEAR balance.
    #[payable]
    pub fn owner_register(&mut self, target_id: AccountId, storage_deposit: U128) -> Promise {
        self.assert_position_owner();
        require!(
            target_id == self.config.lending_id
                || target_id == self.config.debt_token_id
                || target_id == self.config.collateral_token_ids[0],
            "Unsupported registration target"
        );
        require!(storage_deposit.0 > 0, "Positive deposit required");
        let op_id = self.lock_position(0, PositionOperation::Register);
        Promise::new(target_id)
            .function_call(
                "storage_deposit",
                serde_json::to_vec(
                    &json!({"account_id":env::current_account_id(),"registration_only":true}),
                )
                .expect("JSON encoding"),
                NearToken::from_yoctonear(storage_deposit.0),
                Gas::from_tgas(30),
            )
            .then(self.position_callback(op_id))
    }

    /// Borrow the debt token against deposited collateral; the tokens arrive at the
    /// Guardian and are distinct from reserve accounting (`owner_sweep` releases them).
    #[payable]
    pub fn owner_borrow(&mut self, amount: U128) -> Promise {
        self.assert_position_owner();
        let internal = Self::internal_amount(amount.0, self.config.debt_extra_decimals);
        require!(
            env::prepaid_gas() >= Gas::from_tgas(RHEA_EXECUTE_GAS + 20),
            "More gas required"
        );
        let token = self.config.debt_token_id.clone();
        let op_id = self.lock_position(0, PositionOperation::Borrow);
        self.rhea_execute(json!([
            {"Borrow":{"token_id":token,"amount":U128(internal)}},
            // No amount: an exact Withdraw rounds in shares and reverts on a pool whose
            // share price is not 1 (LESSONS 2026-11-11). Rhea withdraws the whole supplied
            // balance; the Borrow amount stays the owner's bound.
            {"Withdraw":{"token_id":token}}
        ]))
        .then(self.position_callback(op_id))
    }

    /// Release collateral from the position back to the Guardian.
    #[payable]
    pub fn owner_withdraw_collateral(&mut self, amount: U128) -> Promise {
        self.assert_position_owner();
        let internal = Self::internal_amount(amount.0, self.config.collateral_extra_decimals);
        require!(
            env::prepaid_gas() >= Gas::from_tgas(RHEA_EXECUTE_GAS + 20),
            "More gas required"
        );
        let token = self.config.collateral_token_ids[0].clone();
        let op_id = self.lock_position(0, PositionOperation::Release);
        self.rhea_execute(json!([
            {"DecreaseCollateral":{"token_id":token,"amount":U128(internal)}},
            {"Withdraw":{"token_id":token}}
        ]))
        .then(self.position_callback(op_id))
    }

    /// Owner-signed repayment from the reserve: no action fee, no trigger check and
    /// no policy bound (the floor binds the automatic path, not the owner).
    #[payable]
    pub fn owner_repay_from_reserve(&mut self, amount: U128) -> Promise {
        self.assert_position_owner();
        require!(
            amount.0 > 0 && amount.0 <= self.reserve,
            "Invalid reserve repayment"
        );
        let msg = self
            .repay_message(amount.0)
            .unwrap_or_else(|| env::panic_str("Internal amount overflow"));
        require!(
            env::prepaid_gas() >= Gas::from_tgas(MANUAL_REPAY_GAS + 2 * CALLBACK_GAS + 10),
            "More gas required"
        );
        self.reserve -= amount.0;
        let op_id = self.lock_position(amount.0, PositionOperation::ManualRepay);
        Promise::new(self.config.debt_token_id.clone())
            .function_call(
                "ft_transfer_call",
                serde_json::to_vec(
                    &json!({"receiver_id":self.config.lending_id,"amount":amount,"msg":msg}),
                )
                .expect("JSON encoding"),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(MANUAL_REPAY_GAS),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(2 * CALLBACK_GAS))
                    .with_unused_gas_weight(0)
                    .on_manual_repay_resolved(op_id),
            )
    }

    /// Send tokens held by the Guardian to the owner. For the debt token only the
    /// balance above all committed obligations moves; the amount is computed when
    /// the balance reply arrives, never from a value read before the lock.
    #[payable]
    pub fn owner_sweep(&mut self, token_id: AccountId) -> Promise {
        self.assert_position_owner();
        let op_id = self.lock_position(0, PositionOperation::SweepRead);
        Promise::new(token_id.clone())
            .function_call(
                "ft_balance_of",
                serde_json::to_vec(&json!({"account_id":env::current_account_id()}))
                    .expect("JSON encoding"),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(10),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(3 * CALLBACK_GAS))
                    .with_unused_gas_weight(0)
                    .on_sweep_balance(op_id, token_id),
            )
    }

    #[private]
    pub fn on_position_resolved(&mut self, op_id: u64) -> bool {
        let operation = self.take_position(
            op_id,
            &[
                PositionOperation::Register,
                PositionOperation::Borrow,
                PositionOperation::Release,
            ],
        );
        let succeeded = Self::single_result_ok();
        events::emit(
            if succeeded {
                "position_operation_succeeded"
            } else {
                "position_operation_failed"
            },
            json!({"op_id":U64(op_id),"operation":format!("{operation:?}").to_lowercase(),"receipt_result":"immediate_only"}),
        );
        succeeded
    }

    /// Returns the amount Rhea did not use. Anything ambiguous returns the whole
    /// amount: the outer NEP-141 resolver refunds at most what the Guardian holds.
    #[private]
    pub fn on_collateral_resolved(&mut self, op_id: u64, amount: U128) -> U128 {
        self.take_position(op_id, &[PositionOperation::Collateral]);
        let used = Self::single_u128(amount.0);
        events::emit(
            "collateral_deposit_resolved",
            json!({"op_id":U64(op_id),"amount":amount,"used":used.map(U128),"observed":used.is_some()}),
        );
        U128(used.map_or(amount.0, |used| amount.0 - used))
    }

    #[private]
    pub fn on_manual_repay_resolved(&mut self, op_id: u64) -> U128 {
        self.assert_position_phase(op_id, &PositionOperation::ManualRepay);
        let amount = self.in_flight.as_ref().expect("Missing operation").amount;
        let Some(used) = Self::single_u128(amount) else {
            // A failed or malformed result does not prove the tokens came back.
            self.pending_position = Some(PositionOperation::Unresolved);
            events::emit(
                "manual_repay_unresolved",
                json!({"op_id":U64(op_id),"reserve_locked":true}),
            );
            return U128(0);
        };
        self.take_position(op_id, &[PositionOperation::ManualRepay]);
        self.reserve = self
            .reserve
            .checked_add(amount - used)
            .expect("Reserve restoration overflow");
        events::emit(
            "manual_repay_settled",
            json!({"op_id":U64(op_id),"used":U128(used),"refunded":U128(amount-used),"reserve":U128(self.reserve),"used_semantics":"accepted_token_spend"}),
        );
        U128(used)
    }

    #[private]
    pub fn on_sweep_balance(&mut self, op_id: u64, token_id: AccountId) -> PromiseOrValue<bool> {
        self.assert_position_phase(op_id, &PositionOperation::SweepRead);
        let balance = (env::promise_results_count() == 1)
            .then(|| env::promise_result_checked(0, 1024).ok())
            .flatten()
            .and_then(|bytes| serde_json::from_slice::<U128>(&bytes).ok())
            .map(|v| v.0);
        let pending = self.in_flight.as_ref().expect("Missing operation");
        let committed = if token_id == self.config.debt_token_id {
            self.reserve
                .saturating_add(pending.amount)
                .saturating_add(pending.fee)
        } else {
            0
        };
        let sweepable = balance.map_or(0, |balance| balance.saturating_sub(committed));
        if sweepable == 0 {
            self.take_position(op_id, &[PositionOperation::SweepRead]);
            events::emit(
                "sweep_skipped",
                json!({"op_id":U64(op_id),"token_id":token_id,"balance":balance.map(U128),"committed":U128(committed)}),
            );
            return PromiseOrValue::Value(false);
        }
        self.pending_position = Some(PositionOperation::SweepSend);
        PromiseOrValue::Promise(
            Promise::new(token_id)
                .function_call(
                    "ft_transfer",
                    serde_json::to_vec(
                        &json!({"receiver_id":self.config.owner_id,"amount":U128(sweepable),"memo":null}),
                    )
                    .expect("JSON encoding"),
                    NearToken::from_yoctonear(1),
                    Gas::from_tgas(10),
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(CALLBACK_GAS))
                        .with_unused_gas_weight(0)
                        .on_sweep_resolved(op_id, U128(sweepable)),
                ),
        )
    }

    /// `ft_transfer` is atomic, so an explicit failure means nothing moved.
    #[private]
    pub fn on_sweep_resolved(&mut self, op_id: u64, amount: U128) -> bool {
        self.take_position(op_id, &[PositionOperation::SweepSend]);
        let succeeded = Self::single_result_ok();
        events::emit(
            if succeeded { "swept" } else { "sweep_failed" },
            json!({"op_id":U64(op_id),"amount":amount}),
        );
        succeeded
    }
}

impl Guardian {
    /// Owner plus exactly 1 yocto, then the shared lock must be free.
    fn assert_position_owner(&self) {
        self.assert_owner();
        require!(self.in_flight.is_none(), "Operation in flight");
    }
    pub(crate) fn fund_collateral(&mut self, amount: u128) -> PromiseOrValue<U128> {
        if env::prepaid_gas() < Gas::from_tgas(COLLATERAL_TRANSFER_GAS + 2 * CALLBACK_GAS + 20) {
            return PromiseOrValue::Value(U128(amount));
        }
        let token = self.config.collateral_token_ids[0].clone();
        let op_id = self.lock_position(amount, PositionOperation::Collateral);
        let msg =
            json!({"Execute":{"actions":[{"IncreaseCollateral":{"token_id":token}}]}}).to_string();
        PromiseOrValue::Promise(
            Promise::new(token)
                .function_call(
                    "ft_transfer_call",
                    serde_json::to_vec(&json!({"receiver_id":self.config.lending_id,"amount":U128(amount),"msg":msg}))
                        .expect("JSON encoding"),
                    NearToken::from_yoctonear(1),
                    Gas::from_tgas(COLLATERAL_TRANSFER_GAS),
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(2 * CALLBACK_GAS))
                        .with_unused_gas_weight(0)
                        .on_collateral_resolved(op_id, U128(amount)),
                ),
        )
    }
    fn lock_position(&mut self, amount: u128, operation: PositionOperation) -> u64 {
        let op_id = self.allocate_op();
        self.in_flight = Some(InFlight {
            op_id,
            amount,
            fee: 0,
            started_ns: env::block_timestamp(),
        });
        self.pending_position = Some(operation);
        op_id
    }
    fn assert_position_phase(&self, op_id: u64, expected: &PositionOperation) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Private callback"
        );
        require!(
            self.pending_position.as_ref() == Some(expected)
                && self.pending_reserve.is_none()
                && self.in_flight.as_ref().is_some_and(|p| p.op_id == op_id),
            "Position operation mismatch"
        );
    }
    /// Verifies the callback is the private, operation-bound continuation of one of
    /// `allowed`, then releases the lock.
    fn take_position(&mut self, op_id: u64, allowed: &[PositionOperation]) -> PositionOperation {
        let operation = self
            .pending_position
            .clone()
            .filter(|operation| allowed.contains(operation))
            .unwrap_or_else(|| env::panic_str("Position operation mismatch"));
        self.assert_position_phase(op_id, &operation);
        self.pending_position = None;
        self.in_flight = None;
        operation
    }
    fn position_callback(&self, op_id: u64) -> Promise {
        Self::ext(env::current_account_id())
            .with_static_gas(Gas::from_tgas(CALLBACK_GAS))
            .with_unused_gas_weight(0)
            .on_position_resolved(op_id)
    }
    fn rhea_execute(&self, actions: Value) -> Promise {
        Promise::new(self.config.lending_id.clone()).function_call(
            "execute_with_pyth",
            serde_json::to_vec(&json!({"actions":actions})).expect("JSON encoding"),
            NearToken::from_yoctonear(1),
            Gas::from_tgas(RHEA_EXECUTE_GAS),
        )
    }
    /// Token atomic units to Rhea internal units (`atomic × 10^extra_decimals`).
    fn internal_amount(amount: u128, extra_decimals: u8) -> u128 {
        require!(amount > 0, "Positive amount required");
        amount
            .checked_mul(10u128.pow(u32::from(extra_decimals)))
            .unwrap_or_else(|| env::panic_str("Internal amount overflow"))
    }
    fn single_result_ok() -> bool {
        env::promise_results_count() == 1 && env::promise_result_checked(0, 1024).is_ok()
    }
    /// A decimal-string amount within `[0, limit]`, or `None` when anything is off.
    fn single_u128(limit: u128) -> Option<u128> {
        if env::promise_results_count() != 1 {
            return None;
        }
        env::promise_result_checked(0, 1024)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<U128>(&bytes).ok())
            .map(|v| v.0)
            .filter(|used| *used <= limit)
    }
}
