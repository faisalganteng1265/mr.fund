//! Owner-funded, sandbox feasibility probe only; not Guardian authority/accounting.
use crate::{trigger::TriggerConfig, Probe, ProbeExt};
use near_sdk::{
    env,
    json_types::U128,
    near, require,
    serde_json::{self, json},
    AccountId, Gas, GasWeight, NearToken, Promise, PromiseOrValue,
};

#[near(serializers=[borsh])]
pub struct ComposedOperation {
    pub amount: u128,
    pub fee: u128,
    pub fee_recipient_id: AccountId,
    pub lending_version: String,
    pub repay_msg_override: Option<String>,
    pub phase: u8,
}

#[near(serializers=[json])]
pub struct ComposedResult {
    pub used: Option<U128>,
    pub fee_charged: U128,
    pub status: String,
}

#[near]
impl Probe {
    #[payable]
    pub fn probe_compose_repay(
        &mut self,
        config: TriggerConfig,
        amount: U128,
        fee: U128,
        fee_recipient_id: AccountId,
        lending_version: String,
        repay_msg_override: Option<String>,
    ) -> Promise {
        self.assert_owner();
        require!(
            env::prepaid_gas() >= Gas::from_tgas(300),
            "300 Tgas required"
        );
        require!(amount.0 > 0, "Positive amount required");
        require!(
            matches!(lending_version.as_str(), "0.11.0" | "0.16.2"),
            "Unsupported lending version"
        );
        require!(
            config.legacy_oracle == (lending_version == "0.11.0"),
            "Oracle/version mismatch"
        );
        if lending_version == "0.11.0" {
            Self::internal(amount, self.debt_extra_decimals);
        }
        self.composed = Some(ComposedOperation {
            amount: amount.0,
            fee: fee.0,
            fee_recipient_id,
            lending_version,
            repay_msg_override,
            phase: 0,
        });
        self.probe_check_trigger(config)
    }

    #[private]
    pub fn on_composed_repay(&mut self, op_id: u64) -> PromiseOrValue<ComposedResult> {
        require!(self.in_flight == Some(op_id), "Operation mismatch");
        let pending = self.composed.as_ref().expect("Missing composed operation");
        require!(pending.phase == 1, "Composed phase mismatch");
        if env::promise_results_count() != 1 {
            return PromiseOrValue::Value(self.composed_unresolved());
        }
        let value = env::promise_result_checked(0, 1024);
        let used = match value {
            Ok(bytes) => match serde_json::from_slice::<U128>(&bytes) {
                Ok(used) if used.0 <= pending.amount => used.0,
                _ => return PromiseOrValue::Value(self.composed_unresolved()),
            },
            Err(_) => {
                return PromiseOrValue::Value(self.composed_finish(Some(0), 0, "transfer_failed"));
            }
        };
        let fee = pending.fee;
        if used == 0 || fee == 0 {
            return PromiseOrValue::Value(self.composed_finish(
                Some(used),
                0,
                if used == 0 { "refunded" } else { "settled" },
            ));
        }
        let recipient = pending.fee_recipient_id.clone();
        self.composed.as_mut().unwrap().phase = 2;
        PromiseOrValue::Promise(
            Promise::new(self.debt_token_id.clone())
                .function_call_weight(
                    "ft_transfer",
                    serde_json::to_vec(&json!({"receiver_id":recipient,"amount":U128(fee)}))
                        .unwrap(),
                    NearToken::from_yoctonear(1),
                    Gas::from_tgas(10),
                    GasWeight(0),
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(10))
                        .with_unused_gas_weight(0)
                        .on_composed_fee(op_id, U128(used)),
                ),
        )
    }

    #[private]
    pub fn on_composed_fee(&mut self, op_id: u64, used: U128) -> ComposedResult {
        require!(self.in_flight == Some(op_id), "Operation mismatch");
        let pending = self.composed.as_ref().expect("Missing composed operation");
        require!(pending.phase == 2, "Composed phase mismatch");
        let paid =
            env::promise_results_count() == 1 && env::promise_result_checked(0, 1024).is_ok();
        let fee = if paid { pending.fee } else { 0 };
        self.composed_finish(
            Some(used.0),
            fee,
            if paid { "settled" } else { "fee_failed" },
        )
    }
}

impl Probe {
    pub(crate) fn start_composed_repay(&mut self, op_id: u64) -> Promise {
        let pending = self.composed.as_ref().expect("Missing composed operation");
        require!(pending.phase == 0, "Composed phase mismatch");
        let amount = U128(pending.amount);
        let msg=pending.repay_msg_override.clone().unwrap_or_else(||if pending.lending_version=="0.16.2"{"\"OnlyRepay\"".into()}else{json!({"Execute":{"actions":[{"Repay":{"token_id":self.debt_token_id,"max_amount":Self::internal(amount,self.debt_extra_decimals)}}]}}).to_string()});
        self.composed.as_mut().unwrap().phase = 1;
        Promise::new(self.debt_token_id.clone())
            .function_call_weight(
                "ft_transfer_call",
                serde_json::to_vec(
                    &json!({"receiver_id":self.lending_id,"amount":amount,"msg":msg}),
                )
                .unwrap(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(85),
                GasWeight(0),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(40))
                    .with_unused_gas_weight(0)
                    .on_composed_repay(op_id),
            )
    }
    fn composed_unresolved(&mut self) -> ComposedResult {
        self.composed.as_mut().unwrap().phase = 3;
        ComposedResult {
            used: None,
            fee_charged: U128(0),
            status: "unresolved".into(),
        }
    }
    fn composed_finish(&mut self, used: Option<u128>, fee: u128, status: &str) -> ComposedResult {
        self.in_flight = None;
        self.composed = None;
        ComposedResult {
            used: used.map(U128),
            fee_charged: U128(fee),
            status: status.into(),
        }
    }
}
