use near_sdk::{
    env,
    json_types::U64,
    serde_json::{json, Value},
};

pub fn emit(event: &str, mut data: Value) {
    data["at_ns"] = json!(U64(env::block_timestamp()));
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard":"mrfund_guardian","version":"1.0.0","event":event,"data":[data]})
    ));
}
