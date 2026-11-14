mod support;

use anyhow::Result;
use serde_json::Value;
use support::encodings::{Call, repay, storage, transfer, transfer_call};

fn assert_vector(call: Call, vector: &Value) {
    assert_eq!(call.receiver, vector["receiver_id"].as_str().unwrap());
    assert_eq!(call.method, vector["method"].as_str().unwrap());
    assert_eq!(call.args, vector["args_json"].as_str().unwrap().as_bytes());
    assert_eq!(call.deposit.to_string(), vector["deposit"]);
}

#[test]
fn every_shared_vector_matches_independent_rust_request_bytes() -> Result<()> {
    let fixture: Value = serde_json::from_str(include_str!("../../../fixtures/encodings.json"))?;
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(
        cases.len(),
        5,
        "Inventory new vectors in both language suites"
    );
    for vector in cases {
        let b = &vector["build"];
        let token = b["tokenId"].as_str().unwrap();
        let receiver = b["receiverId"].as_str().unwrap_or("");
        let amount = b["amount"].as_str().unwrap_or("0").parse()?;
        let call = match vector["name"].as_str().unwrap() {
            "wallet_repay_legacy" => repay(token, receiver, amount, "0.11.0", 12)?,
            "wallet_repay" => repay(token, receiver, amount, "0.16.2", 12)?,
            "guardian_repay" => transfer_call(token, receiver, amount, "{\"repay\":{}}")?,
            "fee_transfer" => transfer(token, receiver, amount)?,
            "storage_deposit" => storage(
                token,
                b["accountId"].as_str().unwrap(),
                b["deposit"].as_str().unwrap().parse()?,
            )?,
            name => panic!("Unasserted vector {name}"),
        };
        assert_vector(call, vector);
    }
    Ok(())
}

#[test]
fn version_and_internal_amount_boundaries_refuse_without_retry() -> Result<()> {
    for version in ["", "0.15.7", "0.16.3"] {
        assert!(repay("debt.testnet", "lending.testnet", 1, version, 12).is_err());
    }
    assert!(repay("debt.testnet", "lending.testnet", 0, "0.16.2", 12).is_err());
    assert!(repay("debt.testnet", "lending.testnet", u128::MAX, "0.11.0", 1).is_err());
    assert!(repay("debt.testnet", "lending.testnet", 1, "0.11.0", 39).is_err());
    let c = repay("debt.testnet", "lending.testnet", u128::MAX, "0.11.0", 0)?;
    let args: Value = serde_json::from_slice(&c.args)?;
    assert_eq!(args["amount"], u128::MAX.to_string());
    let message: Value = serde_json::from_str(args["msg"].as_str().unwrap())?;
    assert_eq!(
        message["Execute"]["actions"][0]["Repay"]["max_amount"],
        u128::MAX.to_string()
    );
    assert!(message["Execute"]["actions"][0]["Repay"]["amount"].is_null());
    assert!(transfer("debt.testnet", "fees.testnet", 0).is_err());
    assert!(storage("debt.testnet", "fees.testnet", 0).is_err());
    Ok(())
}
