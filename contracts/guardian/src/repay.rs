//! Fixed-target automatic repayment; unknown resolver outcomes retain the shared lock.
use crate::{
    events,
    state::{
        Attempt, InFlight, Outcome, RejectReason, RepayPhase, RequestOutcome, Status, HISTORY_LEN,
    },
    Guardian, GuardianExt,
};
use near_sdk::{
    env,
    json_types::{U128, U64},
    near, require,
    serde_json::{self, json},
    Gas, GasWeight, NearToken, Promise, PromiseOrValue,
};

#[near]
impl Guardian {
    #[payable]
    pub fn request_repay(&mut self, amount: U128) -> PromiseOrValue<RequestOutcome> {
        require!(
            env::predecessor_account_id() == self.config.owner_id
                || env::predecessor_account_id() == self.config.watcher_id,
            "Owner or watcher only"
        );
        require!(
            env::attached_deposit().as_yoctonear() == 0,
            "Zero deposit required"
        );
        let op_id = self.allocate_op();
        if let Some(reason) = self.repay_rejection(amount.0, true) {
            return PromiseOrValue::Value(self.reject_repay(op_id, amount.0, reason));
        }
        require!(
            env::prepaid_gas() >= Gas::from_tgas(300),
            "300 Tgas required"
        );
        self.in_flight = Some(InFlight {
            op_id,
            amount: amount.0,
            fee: self.policy.action_fee.0,
            started_ns: env::block_timestamp(),
        });
        self.repay_phase = Some(RepayPhase::Reading);
        self.record_attempt(op_id, amount.0, Outcome::Started, None, 0, 0);
        events::emit(
            "repay_requested",
            json!({"op_id":U64(op_id),"requested":amount}),
        );
        PromiseOrValue::Promise(self.read_trigger(op_id))
    }

    #[private]
    pub fn on_repay_resolved(&mut self, op_id: u64) -> PromiseOrValue<RequestOutcome> {
        self.assert_repay_phase(op_id, &RepayPhase::Repaying);
        let pending = self.in_flight.as_ref().unwrap();
        let amount = pending.amount;
        let fee = pending.fee;
        // A failed promise may be a resolver failure after tokens left. Never invent a refund.
        let used = if env::promise_results_count() == 1 {
            env::promise_result_checked(0, 1024)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<U128>(&bytes).ok())
                .filter(|v| v.0 <= amount)
                .map(|v| v.0)
        } else {
            None
        };
        let Some(used) = used else {
            return PromiseOrValue::Value(self.unresolved_repay(op_id));
        };
        self.reserve = self
            .reserve
            .checked_add(amount - used)
            .expect("Reserve overflow");
        self.spent_total = self.spent_total.checked_add(used).expect("Spend overflow");
        if used == 0 || fee == 0 {
            self.reserve = self
                .reserve
                .checked_add(fee)
                .expect("Fee restoration overflow");
            return PromiseOrValue::Value(self.finish_repay(op_id, used, 0));
        }
        self.repay_phase = Some(RepayPhase::Fee { used: U128(used) });
        PromiseOrValue::Promise(
            Promise::new(self.config.debt_token_id.clone())
                .function_call_weight(
                    "ft_transfer",
                    serde_json::to_vec(
                        &json!({"receiver_id":self.config.fee_recipient_id,"amount":U128(fee)}),
                    )
                    .unwrap(),
                    NearToken::from_yoctonear(1),
                    Gas::from_tgas(10),
                    GasWeight(0),
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(10))
                        .with_unused_gas_weight(0)
                        .on_repay_fee_resolved(op_id),
                ),
        )
    }

    #[private]
    pub fn on_repay_fee_resolved(&mut self, op_id: u64) -> RequestOutcome {
        let used = match self.repay_phase.as_ref() {
            Some(RepayPhase::Fee { used }) => used.0,
            _ => env::panic_str("Repay phase mismatch"),
        };
        self.assert_repay_phase(op_id, &RepayPhase::Fee { used: U128(used) });
        let fee = self.in_flight.as_ref().unwrap().fee;
        // Missing/oversized data is ambiguous; only an explicit failed transfer proves restoration.
        if env::promise_results_count() != 1 {
            return self.unresolved_repay(op_id);
        }
        match env::promise_result_checked(0, 1024) {
            Ok(_) => {
                self.spent_total = self.spent_total.checked_add(fee).expect("Spend overflow");
                self.finish_repay(op_id, used, fee)
            }
            Err(near_sdk::PromiseError::Failed) => {
                self.reserve = self
                    .reserve
                    .checked_add(fee)
                    .expect("Fee restoration overflow");
                events::emit(
                    "repay_fee_failed",
                    json!({"op_id":U64(op_id),"fee_charged":U128(0)}),
                );
                self.finish_repay(op_id, used, 0)
            }
            Err(_) => self.unresolved_repay(op_id),
        }
    }
}

impl Guardian {
    /// The version-specific message Rhea accepts for repaying the caller's own
    /// debt. `None` means the legacy internal-unit amount overflows. Shared by the
    /// automatic and the owner-signed manual path so they cannot drift apart.
    pub(crate) fn repay_message(&self, amount: u128) -> Option<String> {
        if self.config.lending_version == "0.16.2" {
            return Some("\"OnlyRepay\"".to_owned());
        }
        let internal = amount.checked_mul(10u128.pow(u32::from(self.config.debt_extra_decimals)))?;
        Some(
            json!({"Execute":{"actions":[{"Repay":{"token_id":self.config.debt_token_id,"max_amount":internal.to_string()}}]}})
                .to_string(),
        )
    }
    pub(crate) fn allocate_op(&mut self) -> u64 {
        let id = self.next_op_id;
        self.next_op_id = id.checked_add(1).expect("Operation id overflow");
        id
    }
    pub(crate) fn repay_rejection(&self, amount: u128, check_lock: bool) -> Option<RejectReason> {
        use RejectReason::*;
        if self.status != Status::Active {
            return Some(NotActive);
        }
        if check_lock && self.in_flight.is_some() {
            return Some(InFlight);
        }
        if self.last_action_started_ns != 0
            && env::block_timestamp()
                .checked_sub(self.last_action_started_ns)
                .is_none_or(|age| age < u64::from(self.policy.cooldown_sec) * 1_000_000_000)
        {
            return Some(Cooldown);
        }
        if amount == 0 {
            return Some(ZeroAmount);
        }
        if amount > self.policy.max_per_action.0 {
            return Some(AboveMaxPerAction);
        }
        let Some(cost) = amount.checked_add(self.policy.action_fee.0) else {
            return Some(AboveLifetimeCap);
        };
        if self
            .spent_total
            .checked_add(cost)
            .is_none_or(|total| total > self.policy.lifetime_cap.0)
        {
            return Some(AboveLifetimeCap);
        }
        if self
            .reserve
            .checked_sub(cost)
            .is_none_or(|remaining| remaining < self.policy.reserve_floor.0)
        {
            return Some(BelowReserveFloor);
        }
        None
    }
    pub(crate) fn assert_repay_phase(&self, op_id: u64, phase: &RepayPhase) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Private callback"
        );
        require!(
            self.pending_reserve.is_none()
                && self.pending_position.is_none()
                && self.in_flight.as_ref().is_some_and(|p| p.op_id == op_id)
                && self.repay_phase.as_ref() == Some(phase),
            "Repay phase mismatch"
        );
    }
    pub(crate) fn reject_repay(
        &mut self,
        op_id: u64,
        amount: u128,
        reason: RejectReason,
    ) -> RequestOutcome {
        self.record_attempt(op_id, amount, Outcome::Rejected, Some(reason.clone()), 0, 0);
        events::emit(
            "request_rejected",
            json!({"op_id":U64(op_id),"requested":U128(amount),"reason":reason}),
        );
        RequestOutcome::Rejected {
            op_id: U64(op_id),
            reason,
        }
    }
    pub(crate) fn record_attempt(
        &mut self,
        op_id: u64,
        amount: u128,
        outcome: Outcome,
        reason: Option<RejectReason>,
        used: u128,
        fee: u128,
    ) {
        let at_ns = self
            .history
            .iter()
            .find(|a| a.op_id.0 == op_id)
            .map_or_else(
                || {
                    U64(self
                        .in_flight
                        .as_ref()
                        .filter(|p| p.op_id == op_id)
                        .map_or(env::block_timestamp(), |p| p.started_ns))
                },
                |a| a.at_ns,
            );
        let attempt = Attempt {
            op_id: U64(op_id),
            at_ns,
            requested: U128(amount),
            outcome,
            reason,
            used: U128(used),
            fee: U128(fee),
        };
        if let Some(entry) = self.history.iter_mut().find(|a| a.op_id.0 == op_id) {
            *entry = attempt;
        } else {
            if self.history.len() == HISTORY_LEN {
                self.history.pop_front();
            }
            self.history.push_back(attempt);
        }
    }
    fn unresolved_repay(&mut self, op_id: u64) -> RequestOutcome {
        let p = self.in_flight.as_ref().unwrap();
        let (amount, used) = (
            p.amount,
            match self.repay_phase {
                Some(RepayPhase::Fee { used }) => used.0,
                _ => 0,
            },
        );
        self.repay_phase = Some(RepayPhase::Unresolved);
        self.record_attempt(op_id, amount, Outcome::Unresolved, None, used, 0);
        events::emit(
            "repay_unresolved",
            json!({"op_id":U64(op_id),"accepted_spend_known":U128(used),"reserve_locked":true}),
        );
        RequestOutcome::Unresolved { op_id: U64(op_id) }
    }
    fn finish_repay(&mut self, op_id: u64, used: u128, fee: u128) -> RequestOutcome {
        let p = self.in_flight.as_ref().unwrap();
        let amount = p.amount;
        let failed = used == 0;
        self.record_attempt(
            op_id,
            amount,
            if failed {
                Outcome::Failed
            } else {
                Outcome::Settled
            },
            None,
            used,
            fee,
        );
        events::emit(
            if failed {
                "repay_failed"
            } else {
                "repay_settled"
            },
            json!({"op_id":U64(op_id),"used":U128(used),"refunded":U128(amount-used),"fee":U128(fee),"used_semantics":"accepted_token_spend"}),
        );
        self.in_flight = None;
        self.repay_phase = None;
        if failed {
            RequestOutcome::Failed { op_id: U64(op_id) }
        } else {
            RequestOutcome::Executed {
                op_id: U64(op_id),
                used: U128(used),
                fee: U128(fee),
            }
        }
    }
}
