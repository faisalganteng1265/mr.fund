//! P0.4 trigger probe and sandbox composed-flow experiment; no Guardian policy authority.
use crate::{Probe, ProbeExt};
use near_sdk::{
    env, near, require,
    serde_json::{self, json, Value},
    AccountId, Gas, GasWeight, NearToken, Promise, PromiseOrValue,
};
use protocol_trigger::{evaluate, rejected};
pub use protocol_trigger::{TriggerConfig, TriggerReject, TriggerResult};

#[near]
impl Probe {
    /// Owner-supplied parameters are checked against Rhea config and feed mappings.
    /// This probe reads only. A Guardian must bind these inputs to immutable config.
    #[payable]
    pub fn probe_check_trigger(&mut self, config: TriggerConfig) -> Promise {
        self.assert_owner();
        require!(
            config.max_price_age_sec > 0
                && config.max_price_age_sec <= 3600
                && config.threshold_bps >= 10500,
            "Invalid trigger config"
        );
        for price_id in [&config.collateral_price_id, &config.debt_price_id] {
            require!(
                price_id.len() == 64 && price_id.bytes().all(|b| b.is_ascii_hexdigit()),
                "Invalid feed id"
            );
        }
        let op_id = self.next_op_id;
        self.next_op_id = self
            .next_op_id
            .checked_add(1)
            .expect("Operation id overflow");
        self.in_flight = Some(op_id);
        let view = |target: AccountId, method: &str, args: Value, gas: u64| {
            Promise::new(target).function_call_weight(
                method,
                serde_json::to_vec(&args).expect("JSON encoding"),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(gas),
                GasWeight(0),
            )
        };
        let prices = |price_id: &String| {
            let (method, args) = if config.legacy_oracle {
                ("get_price", json!({"price_identifier":price_id}))
            } else {
                (
                    "get_price_no_older_than",
                    json!({"price_id":price_id,"age":config.max_price_age_sec}),
                )
            };
            view(config.oracle_id.clone(), method, args, 10)
        };
        let reads = view(
            self.lending_id.clone(),
            "get_account",
            json!({"account_id":env::current_account_id()}),
            15,
        )
        .and(view(
            self.lending_id.clone(),
            "get_assets",
            json!({"token_ids":[self.collateral_token_id,self.debt_token_id]}),
            15,
        ))
        .and(view(
            self.lending_id.clone(),
            "get_token_pyth_info",
            json!({"token_id":self.collateral_token_id}),
            5,
        ))
        .and(view(
            self.lending_id.clone(),
            "get_token_pyth_info",
            json!({"token_id":self.debt_token_id}),
            5,
        ))
        .and(prices(&config.collateral_price_id))
        .and(prices(&config.debt_price_id))
        .and(view(self.lending_id.clone(), "get_config", json!({}), 10));
        let reads = if self.composed.is_some() {
            reads.and(view(self.lending_id.clone(), "get_version", json!({}), 5))
        } else {
            reads
        };
        reads.then(
            Self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(if self.composed.is_some() {
                    160
                } else {
                    60
                }))
                .with_unused_gas_weight(0)
                .on_trigger_checked(op_id, config),
        )
    }

    #[private]
    pub fn on_trigger_checked(
        &mut self,
        op_id: u64,
        config: TriggerConfig,
    ) -> PromiseOrValue<TriggerResult> {
        require!(self.in_flight == Some(op_id), "Operation mismatch");
        let result = (|| {
            let count = if self.composed.is_some() { 8 } else { 7 };
            if env::promise_results_count() != count {
                return Err(TriggerReject::BadResponse);
            }
            let mut results = Vec::new();
            for i in 0..count {
                let bytes = env::promise_result_checked(i, 32768)
                    .map_err(|_| TriggerReject::BadResponse)?;
                results.push(
                    serde_json::from_slice::<Value>(&bytes)
                        .map_err(|_| TriggerReject::BadResponse)?,
                );
            }
            if results[6]["pyth_oracle_account_id"].as_str() != Some(config.oracle_id.as_str())
                || results[6]["pyth_price_valid_duration_sec"].as_u64()
                    != Some(u64::from(config.max_price_age_sec))
                || results[6]["enable_pyth_oracle"] != true
                || results[2]["price_identifier"] != config.collateral_price_id
                || results[3]["price_identifier"] != config.debt_price_id
            {
                return Err(TriggerReject::InvalidConfig);
            }
            if let Some(pending) = &self.composed {
                let extra = results[1]
                    .as_array()
                    .and_then(|assets| {
                        assets
                            .iter()
                            .find(|a| a["token_id"] == self.debt_token_id.as_str())
                    })
                    .and_then(|a| a["config"]["extra_decimals"].as_u64());
                if results[7].as_str() != Some(pending.lending_version.as_str())
                    || extra != Some(u64::from(self.debt_extra_decimals))
                {
                    return Err(TriggerReject::InvalidConfig);
                }
            }
            let values = [
                &results[0],
                &results[1],
                &results[2],
                &results[3],
                &results[4],
                &results[5],
            ]
            .map(Clone::clone);
            Ok(evaluate(
                &values,
                env::current_account_id().as_str(),
                self.collateral_token_id.as_str(),
                self.debt_token_id.as_str(),
                env::block_timestamp() / 1_000_000_000,
                config.max_price_age_sec,
                config.threshold_bps,
            ))
        })()
        .unwrap_or_else(rejected);
        self.last_trigger_result = Some(result.clone());
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({"standard":"mrfund_probe","version":"1.0.0","event":"trigger_checked","data":[result]})
        ));
        if self.composed.is_some() && result.triggered {
            return PromiseOrValue::Promise(self.start_composed_repay(op_id));
        }
        self.in_flight = None;
        self.composed = None;
        PromiseOrValue::Value(result)
    }

    pub fn get_last_trigger_result(&self) -> Option<TriggerResult> {
        self.last_trigger_result.clone()
    }
}
