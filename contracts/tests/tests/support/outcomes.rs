//! Raw sandbox-only RPC recordings. No credentials or public transactions.
use super::encodings::Call;
use anyhow::{Context, Result, ensure};
use near_workspaces::{Account, Worker, network::Sandbox, result::ExecutionFinalResult};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, path::PathBuf, time::Duration};

pub async fn rpc(worker: &Worker<Sandbox>, method: &str, params: Value) -> Result<Value> {
    let body: Value = reqwest::Client::new()
        .post(worker.rpc_addr())
        .timeout(Duration::from_secs(15))
        .json(&json!({"jsonrpc":"2.0","id":"record","method":method,"params":params}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    ensure!(body.get("error").is_none(), "Sandbox RPC {method}: {body}");
    body.get("result").cloned().context("Missing RPC result")
}

pub async fn record(
    worker: &Worker<Sandbox>,
    signer: &Account,
    request: &Call,
    result: &ExecutionFinalResult,
    scenario: &str,
    source: &Value,
    observations: Value,
) -> Result<()> {
    let hash = result.outcome().transaction_hash.to_string();
    let raw = rpc(
        worker,
        "EXPERIMENTAL_tx_status",
        json!({"tx_hash":hash,"sender_account_id":signer.id(),"wait_until":"FINAL"}),
    )
    .await?;
    ensure!(raw["final_execution_status"] == "FINAL", "Not final: {raw}");
    let mut hashes = BTreeSet::new();
    hashes.insert(
        raw["transaction_outcome"]["block_hash"]
            .as_str()
            .context("Missing block")?
            .to_owned(),
    );
    for outcome in raw["receipts_outcome"]
        .as_array()
        .context("Missing outcomes")?
    {
        hashes.insert(
            outcome["block_hash"]
                .as_str()
                .context("Missing block")?
                .to_owned(),
        );
    }
    let mut blocks = Vec::new();
    for hash in hashes {
        let block = rpc(worker, "block", json!({"block_id":hash})).await?;
        blocks.push(block["header"].clone());
    }
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(
        if std::env::var_os("RECORD_OUTCOMES").is_some() {
            "../../fixtures/outcomes"
        } else {
            "../target/probes/outcomes"
        },
    );
    std::fs::create_dir_all(&path)?;
    let network = source["network"]
        .as_str()
        .context("Missing source network")?;
    let recorded = json!({
        "_provenance":{"kind":"sandbox","prices":"Simulated","chain":"local sandbox, not public testnet/mainnet","sourceWasm":source,"scenario":scenario,
            "recordedAtUnixMs":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis().to_string(),
            "receiverFixtureWasmSha256":format!("{:x}",Sha256::digest(std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/near/probe_fixtures/probe_fixtures.wasm"))?))},
        "request":{"hash":hash,"signerId":signer.id(),"receiverId":request.receiver,"methodName":request.method,"argsJson":String::from_utf8(request.args.clone())?,"deposit":request.deposit.to_string()},
        "evidence":{"network":"testnet","outcome":raw,"blocks":blocks}
        ,"observations":observations
    });
    std::fs::write(
        path.join(format!("{network}-{scenario}.json")),
        format!("{}\n", serde_json::to_string_pretty(&recorded)?),
    )?;
    Ok(())
}
