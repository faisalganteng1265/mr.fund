use near_sdk::{
    json_types::{U128, U64},
    near,
};

pub const HISTORY_LEN: usize = 50;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Created,
    Active,
    Paused,
    Deactivated,
}

#[near(serializers = [borsh])]
pub struct InFlight {
    pub op_id: u64,
    pub amount: u128,
    pub fee: u128,
    pub started_ns: u64,
}

pub use guardian_types::GuardianConfig;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RepayPhase {
    Reading,
    Repaying,
    Fee { used: U128 },
    Unresolved,
}

#[near(serializers=[json])]
#[derive(Clone, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum RequestOutcome {
    Rejected { op_id: U64, reason: RejectReason },
    Executed { op_id: U64, used: U128, fee: U128 },
    Failed { op_id: U64 },
    Unresolved { op_id: U64 },
}

/// Owner position operations that hold the shared lock (`in_flight`). `Unresolved`
/// is terminal: an ambiguous manual repayment has no administrative unlock.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum PositionOperation {
    Register,
    Collateral,
    Borrow,
    Release,
    ManualRepay,
    SweepRead,
    SweepSend,
    Unresolved,
}

#[near(serializers = [borsh])]
#[derive(PartialEq)]
pub enum ReserveOperation {
    Activate,
    Withdraw,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Rejected,
    Started,
    Settled,
    Failed,
    Unresolved,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RejectReason {
    NotActive,
    InFlight,
    Cooldown,
    ZeroAmount,
    AboveMaxPerAction,
    AboveLifetimeCap,
    BelowReserveFloor,
    TriggerNotMet,
    StalePrice,
    UnsupportedPositionShape,
    InvalidConfig,
    BadResponse,
    ArithmeticOverflow,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Attempt {
    pub op_id: U64,
    pub at_ns: U64,
    pub requested: U128,
    pub outcome: Outcome,
    pub reason: Option<RejectReason>,
    pub used: U128,
    pub fee: U128,
}
