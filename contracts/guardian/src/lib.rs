//! Guardian policy, reserve lifecycle and fixed-target automatic repayment.

mod events;
mod policy;
mod position;
mod repay;
mod reserve;
mod state;
mod trigger;
mod views;

use near_sdk::{assert_one_yocto, env, near, require, serde_json::json, AccountId, PanicOnDefault};
use policy::Policy;
use state::{Attempt, GuardianConfig, InFlight, PositionOperation, Status};
use std::collections::VecDeque;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Guardian {
    config: GuardianConfig,
    policy: Policy,
    status: Status,
    reserve: u128,
    spent_total: u128,
    in_flight: Option<InFlight>,
    last_action_started_ns: u64,
    next_op_id: u64,
    history: VecDeque<Attempt>,
    pending_reserve: Option<state::ReserveOperation>,
    pending_position: Option<PositionOperation>,
    repay_phase: Option<state::RepayPhase>,
}

#[near]
impl Guardian {
    #[init]
    pub fn new(config: GuardianConfig, policy: Policy) -> Self {
        require!(
            config.collateral_token_ids.len() == 1
                && config.collateral_token_ids[0] != config.debt_token_id,
            "Exactly one distinct collateral required"
        );
        policy
            .validate()
            .unwrap_or_else(|reason| env::panic_str(reason));
        config.validate();
        Self {
            config,
            policy,
            status: Status::Created,
            reserve: 0,
            spent_total: 0,
            in_flight: None,
            last_action_started_ns: 0,
            next_op_id: 0,
            history: VecDeque::new(),
            pending_reserve: None,
            pending_position: None,
            repay_phase: None,
        }
    }
    #[payable]
    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_owner();
        require!(self.in_flight.is_none(), "Operation in flight");
        policy
            .validate()
            .unwrap_or_else(|reason| env::panic_str(reason));
        require!(
            policy.lifetime_cap.0 >= self.spent_total,
            "Lifetime cap below cumulative spend"
        );
        self.policy = policy;
        events::emit(
            "policy_updated",
            json!({"owner_id":self.config.owner_id,"policy":self.policy}),
        );
    }
    #[payable]
    pub fn rotate_watcher(&mut self, watcher_id: AccountId) {
        self.assert_owner();
        self.config.watcher_id = watcher_id;
        events::emit(
            "watcher_rotated",
            json!({"owner_id":self.config.owner_id,"watcher_id":self.config.watcher_id}),
        );
    }
    #[payable]
    pub fn pause(&mut self) {
        self.transition(Status::Active, Status::Paused, "paused");
    }
    #[payable]
    pub fn resume(&mut self) {
        self.transition(Status::Paused, Status::Active, "resumed");
    }
    #[payable]
    pub fn deactivate(&mut self) {
        self.assert_owner();
        require!(
            matches!(self.status, Status::Active | Status::Paused),
            "Invalid status transition"
        );
        self.status = Status::Deactivated;
        events::emit("deactivated", json!({"owner_id":self.config.owner_id}));
    }
}
impl Guardian {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.config.owner_id,
            "Owner only"
        );
        assert_one_yocto();
    }
    fn transition(&mut self, from: Status, to: Status, event: &str) {
        self.assert_owner();
        require!(self.status == from, "Invalid status transition");
        self.status = to;
        events::emit(event, json!({"owner_id":self.config.owner_id}));
    }
}

#[cfg(test)]
mod tests;
