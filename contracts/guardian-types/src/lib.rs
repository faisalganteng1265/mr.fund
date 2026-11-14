//! Types shared by the Guardian contract and its factory. Holding them in one
//! crate lets the factory validate a policy and its template with the Guardian's
//! own rules without linking the Guardian's exported methods into its wasm.
use near_sdk::{json_types::U128, near, AccountId};

pub const MIN_TRIGGER_HF_BPS: u32 = 10500;
pub const MIN_COOLDOWN_SEC: u32 = 300;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub max_per_action: U128,
    pub lifetime_cap: U128,
    pub reserve_floor: U128,
    pub trigger_hf_bps: u32,
    pub target_hf_bps: Option<u32>,
    pub cooldown_sec: u32,
    pub action_fee: U128,
}
impl Policy {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.max_per_action.0 == 0 {
            return Err("Max per action must be positive");
        }
        if self.lifetime_cap.0 < self.max_per_action.0 {
            return Err("Lifetime cap below max per action");
        }
        if self.trigger_hf_bps < MIN_TRIGGER_HF_BPS {
            return Err("Trigger below minimum");
        }
        if self
            .target_hf_bps
            .is_some_and(|target| target <= self.trigger_hf_bps)
        {
            return Err("Target must exceed trigger");
        }
        if self.cooldown_sec < MIN_COOLDOWN_SEC {
            return Err("Cooldown below minimum");
        }
        Ok(())
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct GuardianConfig {
    pub owner_id: AccountId,
    pub watcher_id: AccountId,
    pub lending_id: AccountId,
    pub oracle_id: AccountId,
    pub debt_token_id: AccountId,
    pub collateral_token_ids: Vec<AccountId>,
    pub fee_recipient_id: AccountId,
    pub activation_fee: U128,
    pub lending_version: String,
    pub debt_extra_decimals: u8,
    pub collateral_extra_decimals: u8,
    pub collateral_price_id: String,
    pub debt_price_id: String,
    pub max_price_age_sec: u32,
}

impl GuardianConfig {
    pub fn validate(&self) {
        near_sdk::require!(
            matches!(self.lending_version.as_str(), "0.11.0" | "0.16.2"),
            "Unsupported lending version"
        );
        near_sdk::require!(
            self.debt_extra_decimals <= 38 && self.collateral_extra_decimals <= 38,
            "Invalid extra decimals"
        );
        near_sdk::require!(
            (1..=3600).contains(&self.max_price_age_sec),
            "Invalid price age"
        );
        for feed in [&self.collateral_price_id, &self.debt_price_id] {
            near_sdk::require!(
                feed.len() == 64 && feed.bytes().all(|b| b.is_ascii_hexdigit()),
                "Invalid feed id"
            );
        }
    }
}
