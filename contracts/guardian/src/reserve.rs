//! P2.2 reserve accounting. Callbacks book only observed transfer outcomes.
use crate::{
    events,
    state::{InFlight, ReserveOperation, Status},
    Guardian, GuardianExt,
};
use near_sdk::{
    env,
    json_types::U128,
    near, require,
    serde_json::{self, json},
    AccountId, Gas, NearToken, Promise, PromiseOrValue,
};

#[derive(near_sdk::serde::Deserialize)]
#[serde(
    crate = "near_sdk::serde",
    rename_all = "snake_case",
    deny_unknown_fields
)]
enum ReceiverMessage {
    Activate {},
    Reserve {},
    Collateral {},
}

#[near]
impl Guardian {
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token_id = env::predecessor_account_id();
        if sender_id != self.config.owner_id || self.in_flight.is_some() || amount.0 == 0 {
            return PromiseOrValue::Value(amount);
        }
        let Ok(message) = serde_json::from_str::<ReceiverMessage>(&msg) else {
            return PromiseOrValue::Value(amount);
        };
        // Each message is valid for exactly one configured token.
        let expected = match message {
            ReceiverMessage::Collateral {} => &self.config.collateral_token_ids[0],
            ReceiverMessage::Reserve {} | ReceiverMessage::Activate {} => {
                &self.config.debt_token_id
            }
        };
        if token_id != *expected {
            return PromiseOrValue::Value(amount);
        }
        match message {
            ReceiverMessage::Collateral {} => self.fund_collateral(amount.0),
            ReceiverMessage::Reserve {} => {
                let Some(reserve) = self.reserve.checked_add(amount.0) else {
                    return PromiseOrValue::Value(amount);
                };
                self.reserve = reserve;
                events::emit(
                    "reserve_deposited",
                    json!({"owner_id":sender_id,"amount":amount,"reserve":U128(self.reserve)}),
                );
                PromiseOrValue::Value(U128(0))
            }
            ReceiverMessage::Activate {} => {
                if self.status != Status::Created {
                    return PromiseOrValue::Value(amount);
                }
                let fee = self.config.activation_fee.0;
                let minimum = fee
                    .checked_add(self.policy.reserve_floor.0)
                    .and_then(|v| v.checked_add(self.policy.max_per_action.0))
                    .and_then(|v| v.checked_add(self.policy.action_fee.0));
                if minimum.is_none_or(|minimum| amount.0 < minimum)
                    || self.reserve.checked_add(amount.0 - fee).is_none()
                {
                    return PromiseOrValue::Value(amount);
                }
                if fee == 0 {
                    self.finish_activation(amount.0, 0);
                    return PromiseOrValue::Value(U128(0));
                }
                let op_id = self.lock_reserve(amount.0, fee, ReserveOperation::Activate);
                PromiseOrValue::Promise(
                    self.token_transfer(self.config.fee_recipient_id.clone(), fee)
                        .then(
                            Self::ext(env::current_account_id())
                                .with_static_gas(Gas::from_tgas(10))
                                .on_activation_resolved(op_id),
                        ),
                )
            }
        }
    }

    #[payable]
    pub fn owner_withdraw_reserve(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        require!(self.in_flight.is_none(), "Operation in flight");
        require!(
            amount.0 > 0 && amount.0 <= self.reserve,
            "Invalid reserve withdrawal"
        );
        self.reserve -= amount.0;
        let op_id = self.lock_reserve(amount.0, 0, ReserveOperation::Withdraw);
        self.token_transfer(self.config.owner_id.clone(), amount.0)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(10))
                    .on_withdraw_resolved(op_id),
            )
    }

    #[private]
    pub fn on_activation_resolved(&mut self, op_id: u64) -> U128 {
        let pending = self.take_reserve_operation(op_id, ReserveOperation::Activate);
        if env::promise_results_count() == 1 && env::promise_result_checked(0, 1024).is_ok() {
            self.finish_activation(pending.amount, pending.fee);
            U128(0)
        } else {
            // The fee did not leave. Returning the full amount lets the outer
            // NEP-141 resolver refund the owner; no reserve was booked.
            events::emit(
                "activation_failed",
                json!({"op_id":near_sdk::json_types::U64(op_id),"refunded":U128(pending.amount)}),
            );
            U128(pending.amount)
        }
    }

    #[private]
    pub fn on_withdraw_resolved(&mut self, op_id: u64) -> bool {
        let pending = self.take_reserve_operation(op_id, ReserveOperation::Withdraw);
        let succeeded =
            env::promise_results_count() == 1 && env::promise_result_checked(0, 1024).is_ok();
        if !succeeded {
            self.reserve = self
                .reserve
                .checked_add(pending.amount)
                .expect("Reserve restoration overflow");
        }
        events::emit(
            if succeeded {
                "reserve_withdrawn"
            } else {
                "reserve_withdraw_failed"
            },
            json!({"op_id":near_sdk::json_types::U64(op_id),"amount":U128(pending.amount),"reserve":U128(self.reserve)}),
        );
        succeeded
    }
}
impl Guardian {
    fn finish_activation(&mut self, amount: u128, fee: u128) {
        self.reserve = self
            .reserve
            .checked_add(amount - fee)
            .expect("Activation reserve overflow");
        self.status = Status::Active;
        events::emit(
            "activated",
            json!({"owner_id":self.config.owner_id,"reserve":U128(self.reserve),"activation_fee":U128(fee),"fee_recipient_id":self.config.fee_recipient_id}),
        );
    }
    fn lock_reserve(&mut self, amount: u128, fee: u128, operation: ReserveOperation) -> u64 {
        let op_id = self.next_op_id;
        self.next_op_id = self
            .next_op_id
            .checked_add(1)
            .expect("Operation id overflow");
        self.in_flight = Some(InFlight {
            op_id,
            amount,
            fee,
            started_ns: env::block_timestamp(),
        });
        self.pending_reserve = Some(operation);
        op_id
    }
    fn take_reserve_operation(&mut self, op_id: u64, operation: ReserveOperation) -> InFlight {
        require!(
            self.pending_reserve.as_ref() == Some(&operation)
                && self.in_flight.as_ref().is_some_and(|p| p.op_id == op_id),
            "Reserve operation mismatch"
        );
        self.pending_reserve = None;
        self.in_flight.take().expect("Missing pending operation")
    }
    fn token_transfer(&self, receiver_id: AccountId, amount: u128) -> Promise {
        Promise::new(self.config.debt_token_id.clone()).function_call(
            "ft_transfer",
            serde_json::to_vec(
                &json!({"receiver_id":receiver_id,"amount":U128(amount),"memo":null}),
            )
            .expect("JSON encoding"),
            NearToken::from_yoctonear(1),
            Gas::from_tgas(10),
        )
    }
}
