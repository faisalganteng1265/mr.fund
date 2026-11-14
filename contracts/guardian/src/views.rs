use crate::{
    policy::Policy,
    state::{Attempt, Status, HISTORY_LEN},
    Guardian, GuardianExt,
};
use near_sdk::{
    json_types::{U128, U64},
    near, AccountId,
};

#[near(serializers = [json])]
pub struct InFlightView {
    pub op_id: U64,
    pub amount: U128,
    pub fee: U128,
    pub started_ns: U64,
    pub repay_phase: Option<crate::state::RepayPhase>,
}
#[near(serializers = [json])]
pub struct StatusView {
    pub status: Status,
    pub owner_id: AccountId,
    pub watcher_id: AccountId,
    pub lending_id: AccountId,
    pub oracle_id: AccountId,
    pub debt_token_id: AccountId,
    pub collateral_token_ids: Vec<AccountId>,
    pub fee_recipient_id: AccountId,
    pub in_flight: Option<InFlightView>,
    pub last_action_started_ns: U64,
}
#[near(serializers = [json])]
pub struct ReserveView {
    pub reserve: U128,
    pub floor: U128,
    pub spendable: U128,
    pub lifetime_cap: U128,
    pub spent_total: U128,
    pub lifetime_remaining: U128,
}

#[near]
impl Guardian {
    pub fn get_config(&self) -> crate::state::GuardianConfig {
        self.config.clone()
    }
    pub fn get_status(&self) -> StatusView {
        let c = &self.config;
        StatusView {
            status: self.status.clone(),
            owner_id: c.owner_id.clone(),
            watcher_id: c.watcher_id.clone(),
            lending_id: c.lending_id.clone(),
            oracle_id: c.oracle_id.clone(),
            debt_token_id: c.debt_token_id.clone(),
            collateral_token_ids: c.collateral_token_ids.clone(),
            fee_recipient_id: c.fee_recipient_id.clone(),
            in_flight: self.in_flight.as_ref().map(|f| InFlightView {
                op_id: U64(f.op_id),
                amount: U128(f.amount),
                fee: U128(f.fee),
                started_ns: U64(f.started_ns),
                repay_phase: self.repay_phase.clone(),
            }),
            last_action_started_ns: U64(self.last_action_started_ns),
        }
    }
    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }
    pub fn get_reserve(&self) -> ReserveView {
        ReserveView {
            reserve: U128(self.reserve),
            floor: self.policy.reserve_floor,
            spendable: U128(self.reserve.saturating_sub(self.policy.reserve_floor.0)),
            lifetime_cap: self.policy.lifetime_cap,
            spent_total: U128(self.spent_total),
            lifetime_remaining: U128(self.policy.lifetime_cap.0.saturating_sub(self.spent_total)),
        }
    }
    /// `from` is an index in the retained ring (not an op id or event cursor).
    pub fn get_history(&self, from: u64, limit: u64) -> Vec<Attempt> {
        if from >= self.history.len() as u64 {
            return Vec::new();
        }
        self.history
            .iter()
            .skip(from as usize)
            .take(limit.min(HISTORY_LEN as u64) as usize)
            .cloned()
            .collect()
    }
}
