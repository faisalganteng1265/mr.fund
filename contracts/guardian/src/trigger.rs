use crate::{
    events,
    state::{RejectReason, RepayPhase, RequestOutcome},
    Guardian, GuardianExt,
};
use near_sdk::{
    env,
    json_types::{U128, U64},
    near,
    serde_json::{self, json, Value},
    Gas, GasWeight, NearToken, Promise, PromiseOrValue,
};
use protocol_trigger::{evaluate, TriggerReject};

impl Guardian {
    pub(crate) fn read_trigger(&self, op_id: u64) -> Promise {
        let c = &self.config;
        let view = |target: near_sdk::AccountId, method: &str, args: Value, gas| {
            Promise::new(target).function_call_weight(
                method,
                serde_json::to_vec(&args).unwrap(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(gas),
                GasWeight(0),
            )
        };
        let price = |feed: &str| {
            if c.lending_version == "0.11.0" {
                view(
                    c.oracle_id.clone(),
                    "get_price",
                    json!({"price_identifier":feed}),
                    10,
                )
            } else {
                view(
                    c.oracle_id.clone(),
                    "get_price_no_older_than",
                    json!({"price_id":feed,"age":c.max_price_age_sec}),
                    10,
                )
            }
        };
        view(
            c.lending_id.clone(),
            "get_account",
            json!({"account_id":env::current_account_id()}),
            15,
        )
        .and(view(
            c.lending_id.clone(),
            "get_assets",
            json!({"token_ids":[c.collateral_token_ids[0],c.debt_token_id]}),
            15,
        ))
        .and(view(
            c.lending_id.clone(),
            "get_token_pyth_info",
            json!({"token_id":c.collateral_token_ids[0]}),
            5,
        ))
        .and(view(
            c.lending_id.clone(),
            "get_token_pyth_info",
            json!({"token_id":c.debt_token_id}),
            5,
        ))
        .and(price(&c.collateral_price_id))
        .and(price(&c.debt_price_id))
        .and(view(c.lending_id.clone(), "get_config", json!({}), 10))
        .and(view(c.lending_id.clone(), "get_version", json!({}), 5))
        .then(
            Self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(160))
                .with_unused_gas_weight(0)
                .on_trigger_checked(op_id),
        )
    }
    fn checked_trigger(&self) -> Result<(), RejectReason> {
        if env::promise_results_count() != 8 {
            return Err(RejectReason::BadResponse);
        }
        let mut results = Vec::with_capacity(8);
        for i in 0..8 {
            let bytes =
                env::promise_result_checked(i, 32768).map_err(|_| RejectReason::BadResponse)?;
            results.push(
                serde_json::from_slice::<Value>(&bytes).map_err(|_| RejectReason::BadResponse)?,
            );
        }
        let c = &self.config;
        if results[6]["pyth_oracle_account_id"] != c.oracle_id.as_str()
            || results[6]["pyth_price_valid_duration_sec"] != c.max_price_age_sec
            || results[6]["enable_pyth_oracle"] != true
            || results[2]["price_identifier"] != c.collateral_price_id
            || results[3]["price_identifier"] != c.debt_price_id
            || results[7] != c.lending_version
        {
            return Err(RejectReason::InvalidConfig);
        }
        let assets = results[1].as_array().ok_or(RejectReason::BadResponse)?;
        for (token, extra) in [
            (&c.debt_token_id, c.debt_extra_decimals),
            (&c.collateral_token_ids[0], c.collateral_extra_decimals),
        ] {
            let asset = assets
                .iter()
                .find(|a| a["token_id"] == token.as_str())
                .ok_or(RejectReason::InvalidConfig)?;
            if asset["config"]["extra_decimals"] != extra {
                return Err(RejectReason::InvalidConfig);
            }
        }
        let values = [
            results[0].clone(),
            results[1].clone(),
            results[2].clone(),
            results[3].clone(),
            results[4].clone(),
            results[5].clone(),
        ];
        let result = evaluate(
            &values,
            env::current_account_id().as_str(),
            c.collateral_token_ids[0].as_str(),
            c.debt_token_id.as_str(),
            env::block_timestamp() / 1_000_000_000,
            c.max_price_age_sec,
            self.policy.trigger_hf_bps,
        );
        if result.triggered {
            return Ok(());
        }
        Err(match result.reason.unwrap_or(TriggerReject::BadResponse) {
            TriggerReject::StalePrice => RejectReason::StalePrice,
            TriggerReject::UnsupportedPositionShape => RejectReason::UnsupportedPositionShape,
            TriggerReject::InvalidConfig => RejectReason::InvalidConfig,
            TriggerReject::BadResponse => RejectReason::BadResponse,
            TriggerReject::ArithmeticOverflow => RejectReason::ArithmeticOverflow,
            TriggerReject::NoDebt | TriggerReject::TriggerNotMet => RejectReason::TriggerNotMet,
        })
    }
}

#[near]
impl Guardian {
    #[private]
    pub fn on_trigger_checked(&mut self, op_id: u64) -> PromiseOrValue<RequestOutcome> {
        self.assert_repay_phase(op_id, &RepayPhase::Reading);
        let amount = self.in_flight.as_ref().unwrap().amount;
        if let Some(reason) = self
            .repay_rejection(amount, false)
            .or_else(|| self.checked_trigger().err())
        {
            let result = self.reject_repay(op_id, amount, reason);
            self.in_flight = None;
            self.repay_phase = None;
            return PromiseOrValue::Value(result);
        }
        let Some(msg) = self.repay_message(amount) else {
            let result = self.reject_repay(op_id, amount, RejectReason::ArithmeticOverflow);
            self.in_flight = None;
            self.repay_phase = None;
            return PromiseOrValue::Value(result);
        };
        let fee = self.in_flight.as_ref().unwrap().fee;
        self.reserve = self
            .reserve
            .checked_sub(amount.checked_add(fee).unwrap())
            .unwrap();
        self.last_action_started_ns = env::block_timestamp();
        self.repay_phase = Some(RepayPhase::Repaying);
        events::emit(
            "repay_started",
            json!({"op_id":U64(op_id),"requested":U128(amount),"fee_reserved":U128(fee)}),
        );
        PromiseOrValue::Promise(Promise::new(self.config.debt_token_id.clone()).function_call_weight("ft_transfer_call",serde_json::to_vec(&json!({"receiver_id":self.config.lending_id,"amount":U128(amount),"msg":msg})).unwrap(),NearToken::from_yoctonear(1),Gas::from_tgas(85),GasWeight(0))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(40)).with_unused_gas_weight(0).on_repay_resolved(op_id)))
    }
}
