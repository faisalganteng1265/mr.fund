use anyhow::{bail, Context, Result};
use near_workspaces::{
    types::{Gas, NearToken},
    Account, Contract,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
mod support;
use support::encodings;
#[path = "support/outcomes.rs"]
mod outcome_recordings;
#[path = "support/position_flow.rs"]
mod position_flow;
#[path = "support/rounding_flow.rs"]
mod rounding_flow;

async fn capture_outcome(
    worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>,
    signer: &Account,
    lending: &Contract,
    request: encodings::Call,
    name: &str,
    source: &Value,
) -> Result<near_workspaces::result::ExecutionFinalResult> {
    let before = position(lending, signer).await?;
    let result = signer
        .call(&request.receiver.parse()?, request.method)
        .args(request.args.clone())
        .deposit(NearToken::from_yoctonear(request.deposit))
        .max_gas()
        .transact()
        .await?;
    let after = position(lending, signer).await?;
    outcome_recordings::record(
        worker,
        signer,
        &request,
        &result,
        name,
        source,
        json!({"before":before,"after":after}),
    )
    .await?;
    Ok(result)
}

async fn record_outcomes(
    worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>,
    owner: &Account,
    unregistered: &Account,
    lending: &Contract,
    debt: &Contract,
    receiver: &Contract,
    source: &Value,
) -> Result<()> {
    let version = source["version"].as_str().unwrap();
    // Separate zero-rate owner loan for reproducible outcome recordings.
    call(owner, lending, "execute_with_pyth", json!({"actions":[{"Borrow":{"token_id":debt.id(),"amount":"10000000000000000001"}},{"Withdraw":{"token_id":debt.id(),"amount":"10000000000000000000"}}]}), NearToken::from_yoctonear(1)).await?;
    let success = capture_outcome(
        worker,
        owner,
        lending,
        encodings::repay(
            debt.id().as_str(),
            lending.id().as_str(),
            1_000_000,
            version,
            12,
        )?,
        "repay-success",
        source,
    )
    .await?;
    assert!(success.failures().is_empty());
    let failed_fee = capture_outcome(
        worker,
        owner,
        lending,
        encodings::transfer(debt.id().as_str(), unregistered.id().as_str(), 1)?,
        "fee-failure",
        source,
    )
    .await?;
    assert!(!failed_fee.failures().is_empty());
    let refund = capture_outcome(
        worker,
        owner,
        lending,
        encodings::transfer_call(
            debt.id().as_str(),
            lending.id().as_str(),
            2,
            "invalid-rhea-message",
        )?,
        "full-refund",
        source,
    )
    .await?;
    assert_eq!(refund.json::<String>()?, "0");
    encoded_call(
        owner,
        encodings::storage(debt.id().as_str(), receiver.id().as_str(), 10u128.pow(22))?,
    )
    .await?;
    let partial = capture_outcome(
        worker,
        owner,
        lending,
        encodings::transfer_call(
            debt.id().as_str(),
            receiver.id().as_str(),
            4,
            "\"OnlyRepay\"",
        )?,
        "partial-refund-fixture-receiver",
        source,
    )
    .await?;
    assert!(partial.failures().is_empty());
    assert_eq!(partial.json::<String>()?, "2");
    let strict = json!({"Execute":{"actions":[{"Repay":{"token_id":debt.id(),"amount":"9000001000000000000"}}]}}).to_string();
    let detached = capture_outcome(
        worker,
        owner,
        lending,
        encodings::transfer_call(
            debt.id().as_str(),
            lending.id().as_str(),
            9_000_001,
            &strict,
        )?,
        "detached-failure",
        source,
    )
    .await?;
    assert!(!detached.failures().is_empty());
    // Failed strict action can accept tokens into supplied balance, so refill
    // the wallet locally before the valid bounded full repayment.
    call(
        owner,
        debt,
        "mint",
        json!({"account_id":owner.id(),"amount":"9000001"}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    let surplus = capture_outcome(
        worker,
        owner,
        lending,
        encodings::repay(
            debt.id().as_str(),
            lending.id().as_str(),
            9_000_001,
            version,
            12,
        )?,
        "repay-surplus",
        source,
    )
    .await?;
    assert!(surplus.failures().is_empty());
    assert_eq!(position(lending, owner).await?["borrowed"], json!([]));
    Ok(())
}

async fn encoded_call(signer: &Account, request: encodings::Call) -> Result<Value> {
    let result = signer
        .call(&request.receiver.parse()?, request.method)
        .args(request.args)
        .deposit(NearToken::from_yoctonear(request.deposit))
        .max_gas()
        .transact()
        .await?;
    if !result.failures().is_empty() {
        bail!("{}: {:?}", request.method, result.failures());
    }
    Ok(result.json().unwrap_or(Value::Null))
}

async fn composed_probe_checks(
    worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>,
    owner: &Account,
    unregistered: &Account,
    targets: [&Contract; 4],
    source: &Value,
) -> Result<()> {
    let [lending, collateral, debt, oracle] = targets;
    let probe = worker
        .dev_deploy(&std::fs::read(target("near/probe/probe.wasm"))?)
        .await?;
    call(owner,&probe,"new",json!({"owner_id":owner.id(),"lending_id":lending.id(),"collateral_token_id":collateral.id(),"debt_token_id":debt.id(),"debt_extra_decimals":12,"collateral_extra_decimals":0}),NearToken::from_yoctonear(0)).await?;
    for contract in [lending, collateral, debt] {
        call(
            owner,
            &probe,
            "probe_register",
            json!({"target_id":contract.id(),"storage_deposit":"1000000000000000000000000"}),
            NearToken::from_yoctonear(1),
        )
        .await?;
    }
    encoded_call(
        owner,
        encodings::transfer_call(
            collateral.id().as_str(),
            probe.id().as_str(),
            20_000_000,
            "",
        )?,
    )
    .await?;
    call(
        owner,
        &probe,
        "probe_supply_collateral",
        json!({"amount":"20000000"}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    call(
        owner,
        &probe,
        "probe_borrow",
        json!({"amount":"5000000"}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    let network = source["network"].as_str().unwrap();
    for scenario in ["success", "refund", "transfer_failure", "fee_failure"] {
        if scenario == "success" || scenario == "fee_failure" {
            encoded_call(
                owner,
                encodings::transfer_call(debt.id().as_str(), probe.id().as_str(), 100, "")?,
            )
            .await?;
        }
        let before = balance(debt, probe.as_account()).await?;
        let debt_before: u128 = position(lending, probe.as_account()).await?["borrowed"][0]
            ["balance"]
            .as_str()
            .unwrap()
            .parse()?;
        let amount = if scenario == "transfer_failure" {
            100_000_000u128
        } else {
            1_000_000
        };
        let config = json!({"oracle_id":oracle.id(),"collateral_price_id":"11".repeat(32),"debt_price_id":"22".repeat(32),"max_price_age_sec":60,"threshold_bps":1000000,"legacy_oracle":network=="testnet"});
        let result=owner.call(probe.id(),"probe_compose_repay").args_json(json!({"config":config,"amount":amount.to_string(),"fee":"100","fee_recipient_id":if scenario=="fee_failure"{unregistered.id()}else{owner.id()},"lending_version":source["version"],"repay_msg_override":if scenario=="refund"{Some("invalid-rhea-message")}else{None}})).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(300)).transact().await?;
        let output: Value = result.clone().json()?;
        let used = if scenario == "success" || scenario == "fee_failure" {
            1_000_000u128
        } else {
            0
        };
        let fee = if scenario == "success" { 100u128 } else { 0 };
        assert_eq!(
            output["used"],
            used.to_string(),
            "{network}/{scenario}: {output}"
        );
        assert_eq!(output["fee_charged"], fee.to_string());
        assert_eq!(
            output["status"],
            match scenario {
                "success" => "settled",
                "refund" => "refunded",
                "transfer_failure" => "transfer_failed",
                _ => "fee_failed",
            }
        );
        assert_eq!(
            balance(debt, probe.as_account()).await?,
            before - used - fee
        );
        assert_eq!(
            position(lending, probe.as_account()).await?["borrowed"][0]["balance"],
            (debt_before - used * 10u128.pow(12)).to_string()
        );
        if scenario == "success" {
            assert!(result.failures().is_empty(), "{:?}", result.failures());
        } else {
            assert!(!result.failures().is_empty());
        }
        let raw=outcome_recordings::rpc(worker,"EXPERIMENTAL_tx_status",json!({"tx_hash":result.outcome().transaction_hash.to_string(),"sender_account_id":owner.id(),"wait_until":"FINAL"})).await?;
        assert_eq!(
            raw["transaction"]["actions"][0]["FunctionCall"]["gas"],
            300_000_000_000_000u64
        );
        let receipts = raw["receipts"]
            .as_array()
            .context("Missing gas receipt details")?;
        let allocated: std::collections::BTreeMap<String, u64> = receipts
            .iter()
            .filter_map(|r| {
                let fc = &r["receipt"]["Action"]["actions"][0]["FunctionCall"];
                Some((r["receipt_id"].as_str()?.to_owned(), fc["gas"].as_u64()?))
            })
            .collect();
        let mut report = Vec::new();
        let mut failed_methods = Vec::new();
        for outcome in raw["receipts_outcome"].as_array().unwrap() {
            let id = outcome["id"].as_str().unwrap();
            let Some(&budget) = allocated.get(id) else {
                continue;
            };
            let receipt = receipts.iter().find(|r| r["receipt_id"] == id).unwrap();
            let method = receipt["receipt"]["Action"]["actions"][0]["FunctionCall"]["method_name"]
                .as_str()
                .unwrap();
            let burnt = outcome["outcome"]["gas_burnt"].as_u64().unwrap();
            let status = &outcome["outcome"]["status"];
            if status.get("Failure").is_some() {
                let error = status.to_string().to_lowercase();
                assert!(
                    !error.contains("gasexceeded")
                        && !error.contains("gaslimitexceeded")
                        && !error.contains("exceeded the prepaid gas"),
                    "Unexpected gas failure: {status}"
                );
                failed_methods.push(method.to_owned());
            }
            let children: u64 = outcome["outcome"]["receipt_ids"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|id| allocated.get(id.as_str()?))
                .sum();
            let margin = budget
                .checked_sub(burnt + children)
                .context("Child reservations exceed receipt allocation")?;
            if receipt["receiver_id"] == probe.id().as_str() {
                assert!(
                    margin >= 2_000_000_000_000,
                    "Insufficient continuation margin in {network}/{scenario}/{method}: {margin}"
                );
            }
            report.push(json!({"id":id,"receiver_id":receipt["receiver_id"],"status":status,"method":method,"allocated":budget,"burnt":burnt,"child_reserved":children,"margin":margin}));
        }
        let expected_failures: Vec<String> = match scenario {
            "success" => vec![],
            "refund" => vec!["ft_on_transfer".into()],
            "transfer_failure" => vec!["ft_transfer_call".into()],
            _ => vec!["ft_transfer".into()],
        };
        assert_eq!(
            failed_methods, expected_failures,
            "{network}/{scenario}: unexpected failed receipt"
        );
        assert!(report.iter().any(|r| r["method"] == "on_composed_repay"));
        if used > 0 {
            assert!(report.iter().any(|r| r["method"] == "on_composed_fee"));
        }
        std::fs::write(
            target(&format!("probes/composed-gas-{network}-{scenario}.json")),
            serde_json::to_vec_pretty(
                &json!({"kind":"sandbox","prices":"Simulated","sourceWasm":source,"rootGas":300_000_000_000_000u64,"scenario":scenario,"result":output,"receipts":report}),
            )?,
        )?;
        println!(
            "Composed {network}/{scenario}: burnt {} gas, {output}",
            result.total_gas_burnt.as_gas()
        );
    }
    Ok(())
}

fn target(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../target")
        .join(path)
}

fn sandbox_operator(input: &Value) -> Result<std::process::Output> {
    use std::io::Write;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut child = std::process::Command::new(root.join("apps/watcher/node_modules/.bin/tsx"))
        .arg(root.join("apps/watcher/src/sandbox/operator-cli.ts"))
        .arg("--sandbox-only")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    write!(child.stdin.take().context("operator stdin")?, "{input}")?;
    Ok(child.wait_with_output()?)
}

/// Sandbox seeding only: provision a position with the throwaway probe, then
/// replace its code/STATE with a freshly initialized Guardian. No production
/// provisioning, migration or upgrade entrypoint is added by this experiment.
async fn guardian_imported_checks(
    worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>,
    owner: &Account,
    watcher: &Account,
    targets: [&Contract; 4],
    source: &Value,
) -> Result<()> {
    let [lending, collateral, debt, oracle] = targets;
    let guardian_wasm = std::fs::read(target("near/guardian/guardian.wasm"))?;
    for scenario in ["success", "fee_failure", "pause_race"] {
        let fee_failure = scenario == "fee_failure";
        let pause_race = scenario == "pause_race";
        let account = worker
            .dev_deploy(&std::fs::read(target("near/probe/probe.wasm"))?)
            .await?;
        call(owner,&account,"new",json!({"owner_id":owner.id(),"lending_id":lending.id(),"collateral_token_id":collateral.id(),"debt_token_id":debt.id(),"debt_extra_decimals":12,"collateral_extra_decimals":0}),NearToken::from_yoctonear(0)).await?;
        for contract in [lending, collateral, debt] {
            call(
                owner,
                &account,
                "probe_register",
                json!({"target_id":contract.id(),"storage_deposit":"1000000000000000000000000"}),
                NearToken::from_yoctonear(1),
            )
            .await?;
        }
        encoded_call(
            owner,
            encodings::transfer_call(
                collateral.id().as_str(),
                account.id().as_str(),
                20_000_000,
                "",
            )?,
        )
        .await?;
        call(
            owner,
            &account,
            "probe_supply_collateral",
            json!({"amount":"20000000"}),
            NearToken::from_yoctonear(1),
        )
        .await?;
        call(
            owner,
            &account,
            "probe_borrow",
            json!({"amount":"5000000"}),
            NearToken::from_yoctonear(1),
        )
        .await?;
        let seed = worker.dev_deploy(&guardian_wasm).await?;
        let init = json!({"config":{"owner_id":if pause_race{oracle.id()}else{owner.id()},"watcher_id":watcher.id(),"lending_id":lending.id(),"oracle_id":oracle.id(),"debt_token_id":debt.id(),"collateral_token_ids":[collateral.id()],"fee_recipient_id":if fee_failure{watcher.id()}else{owner.id()},"activation_fee":"0","lending_version":source["version"],"debt_extra_decimals":12,"collateral_extra_decimals":0,"collateral_price_id":"11".repeat(32),"debt_price_id":"22".repeat(32),"max_price_age_sec":60},"policy":{"max_per_action":"1000000","lifetime_cap":"10000000","reserve_floor":"100","trigger_hf_bps":1000000,"target_hf_bps":null,"cooldown_sec":300,"action_fee":"100"}});
        call(owner, &seed, "new", init, NearToken::from_yoctonear(0)).await?;
        let states = seed.view_state().await?;
        worker
            .patch(account.id())
            .code(&guardian_wasm)
            .state(
                b"STATE",
                states
                    .get(b"STATE".as_slice())
                    .context("Guardian state missing")?,
            )
            .transact()
            .await?;
        account
            .batch()
            .delete_key(account.as_account().secret_key().public_key())
            .transact()
            .await?
            .into_result()?;
        assert!(account.view_access_keys().await?.is_empty());
        if pause_race {
            call(
                owner,
                debt,
                "storage_deposit",
                json!({"account_id":oracle.id()}),
                NearToken::from_near(1),
            )
            .await?;
            call(
                owner,
                debt,
                "mint",
                json!({"account_id":oracle.id(),"amount":"2000000"}),
                NearToken::from_yoctonear(0),
            )
            .await?;
            call(owner,oracle,"send_fixture_tokens",json!({"token":debt.id(),"receiver":account.id(),"amount":"2000000","msg":"{\"activate\":{}}"}),NearToken::from_yoctonear(0)).await?;
            call(
                owner,
                oracle,
                "set_pause_target",
                json!({"target":account.id()}),
                NearToken::from_yoctonear(0),
            )
            .await?;
        } else {
            encoded_call(
                owner,
                encodings::transfer_call(
                    debt.id().as_str(),
                    account.id().as_str(),
                    2_000_000,
                    "{\"activate\":{}}",
                )?,
            )
            .await?;
        }
        let before = balance(debt, account.as_account()).await?;
        let debt_before: u128 =
            position(lending, account.as_account()).await?["borrowed"][0]["balance"]
                .as_str()
                .unwrap()
                .parse()?;
        // A fresh sandbox-only key can call only this Guardian's request_repay.
        let scoped_key = near_workspaces::types::SecretKey::from_random(
            near_workspaces::types::KeyType::ED25519,
        );
        watcher
            .batch(watcher.id())
            .add_key(
                scoped_key.public_key(),
                near_workspaces::types::AccessKey::function_call_access(
                    account.id(),
                    &["request_repay"],
                    Some(NearToken::from_near(5)),
                ),
            )
            .transact()
            .await?
            .into_result()?;
        let scoped_secret = scoped_key.to_string();
        let scoped_watcher = Account::from_secret_key(watcher.id().clone(), scoped_key, worker);
        // Explicit operator-style max+1 request, before the accepted action starts cooldown.
        let reserve_before: Value = account.view("get_reserve").await?.json()?;
        let journal_dir = std::env::temp_dir().join(format!(
            "mrfund-sandbox-journal-{}-{}",
            std::process::id(),
            account.id()
        ));
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            std::fs::DirBuilder::new().mode(0o700).create(&journal_dir)?;
        }
        #[cfg(not(unix))]
        std::fs::create_dir(&journal_dir)?;
        let input = json!({
            "rpcUrl": worker.rpc_addr(), "guardianId": account.id(),
            "watcherId": watcher.id(), "secretKey": scoped_secret,
            "journalDirectory": journal_dir
        });
        let output = sandbox_operator(&input)?;
        assert!(
            output.status.success(),
            "sandbox operator failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let submission: Value = serde_json::from_slice(&output.stdout)?;
        assert_eq!(submission["kind"], "pending");
        let hash = submission["hash"].as_str().context("operator hash")?;
        let raw = outcome_recordings::rpc(
            worker,
            "EXPERIMENTAL_tx_status",
            json!({"tx_hash":hash,"sender_account_id":watcher.id(),"wait_until":"FINAL"}),
        )
        .await?;
        assert_eq!(raw["final_execution_status"], "FINAL");
        let journal_file = std::fs::read_dir(&journal_dir)?.next().context("missing journal")??;
        let journal = std::fs::read_to_string(journal_file.path())?;
        let records: Vec<Value> = journal
            .lines()
            .map(serde_json::from_str)
            .collect::<Result<_, _>>()?;
        assert_eq!(records.len(), 2);
        assert_eq!(records[0]["network"], "sandbox");
        assert_eq!(records[1]["hash"], hash);
        let restarted = sandbox_operator(&input)?;
        assert!(
            !restarted.status.success(),
            "existing journal must prevent a second request"
        );
        assert!(restarted.stdout.is_empty());
        let restart_error: Value = serde_json::from_slice(&restarted.stderr)?;
        assert_eq!(restart_error["event"], "sandbox_operator_failed");
        assert_eq!(restart_error["reason"], "operator_failed");
        let rejection_history: Value = account
            .view("get_history")
            .args_json(json!({"from":0,"limit":50}))
            .await?
            .json()?;
        assert_eq!(rejection_history[0]["outcome"], "rejected");
        assert_eq!(rejection_history[0]["reason"], "above_max_per_action");
        assert_eq!(rejection_history.as_array().unwrap().len(), 1);
        std::fs::remove_dir_all(&journal_dir)?;
        let op_id = rejection_history[0]["op_id"]
            .as_str()
            .context("rejection operation id")?;
        assert!(
            raw["receipts_outcome"]
                .as_array()
                .context("receipt outcomes")?
                .iter()
                .any(|receipt| {
                    receipt["outcome"]["logs"].as_array().is_some_and(|logs| {
                        logs.iter().any(|entry| {
                            entry.as_str().is_some_and(|line| {
                                line.contains("request_rejected")
                                    && line.contains("above_max_per_action")
                                    && line.contains(op_id)
                            })
                        })
                    })
                })
        );
        assert_eq!(
            account.view("get_reserve").await?.json::<Value>()?,
            reserve_before
        );
        assert_eq!(balance(debt, account.as_account()).await?, before);
        assert_eq!(
            position(lending, account.as_account()).await?["borrowed"][0]["balance"],
            debt_before.to_string()
        );
        println!("sandbox operator test request: {}", hash);
        let outcome = scoped_watcher
            .call(account.id(), "request_repay")
            .args_json(json!({"amount":"1000000"}))
            .gas(Gas::from_tgas(300))
            .transact()
            .await?;
        let output: Value = outcome.clone().json()?;
        if pause_race {
            assert_eq!(output["outcome"], "rejected");
            assert_eq!(output["reason"], "not_active");
            assert_eq!(balance(debt, account.as_account()).await?, before);
            assert_eq!(
                position(lending, account.as_account()).await?["borrowed"][0]["balance"],
                debt_before.to_string()
            );
            let status: Value = account.view("get_status").await?.json()?;
            assert_eq!(status["status"], "paused");
            assert!(status["in_flight"].is_null());
            assert!(outcome.failures().is_empty(), "{:?}", outcome.failures());
            assert!(
                outcome
                    .logs()
                    .iter()
                    .any(|log| log.contains("repay_requested"))
            );
            assert!(
                !outcome
                    .logs()
                    .iter()
                    .any(|log| log.contains("repay_started"))
            );
            call(
                owner,
                oracle,
                "set_pause_target",
                json!({"target":null}),
                NearToken::from_yoctonear(0),
            )
            .await?;
            println!(
                "Guardian {}: pause during joined reads prevented dispatch",
                source["version"]
            );
            continue;
        }
        let fee = if fee_failure { 0u128 } else { 100 };
        assert_eq!(output["outcome"], "executed");
        assert_eq!(output["used"], "1000000");
        assert_eq!(output["fee"], fee.to_string());
        assert_eq!(
            balance(debt, account.as_account()).await?,
            before - 1_000_000 - fee
        );
        assert_eq!(
            position(lending, account.as_account()).await?["borrowed"][0]["balance"],
            (debt_before - 1_000_000 * 10u128.pow(12)).to_string()
        );
        let reserve: Value = account.view("get_reserve").await?.json()?;
        assert_eq!(reserve["reserve"], (1_000_000 - fee).to_string());
        assert_eq!(reserve["spent_total"], (1_000_000 + fee).to_string());
        let status: Value = account.view("get_status").await?.json()?;
        assert!(status["in_flight"].is_null());
        let history: Value = account
            .view("get_history")
            .args_json(json!({"from":0,"limit":50}))
            .await?
            .json()?;
        assert_eq!(history.as_array().unwrap().len(), 2);
        assert_eq!(history[1]["used"], "1000000");
        assert_eq!(history[1]["fee"], fee.to_string());
        let raw=outcome_recordings::rpc(worker,"EXPERIMENTAL_tx_status",json!({"tx_hash":outcome.outcome().transaction_hash.to_string(),"sender_account_id":watcher.id(),"wait_until":"FINAL"})).await?;
        assert_eq!(
            raw["transaction"]["actions"][0]["FunctionCall"]["gas"],
            300_000_000_000_000u64
        );
        let receipts = raw["receipts"].as_array().unwrap();
        let allocated: std::collections::BTreeMap<_, _> = receipts
            .iter()
            .filter_map(|r| {
                Some((
                    r["receipt_id"].as_str()?,
                    r["receipt"]["Action"]["actions"][0]["FunctionCall"]["gas"].as_u64()?,
                ))
            })
            .collect();
        for o in raw["receipts_outcome"].as_array().unwrap() {
            let id = o["id"].as_str().unwrap();
            let Some(&budget) = allocated.get(id) else {
                continue;
            };
            let r = receipts.iter().find(|r| r["receipt_id"] == id).unwrap();
            if r["receiver_id"] == account.id().as_str() {
                let children: u64 = o["outcome"]["receipt_ids"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(|id| allocated.get(id.as_str()?))
                    .sum();
                assert!(
                    budget
                        .checked_sub(o["outcome"]["gas_burnt"].as_u64().unwrap() + children)
                        .is_some_and(|margin| margin >= 2_000_000_000_000)
                );
                assert!(o["outcome"]["status"].get("Failure").is_none());
            }
        }
        assert_eq!(outcome.failures().len(), usize::from(fee_failure));
        std::fs::write(
            target(&format!(
                "probes/guardian-gas-{}-{}.json",
                source["network"].as_str().unwrap(),
                if fee_failure {
                    "fee_failure"
                } else {
                    "success"
                }
            )),
            serde_json::to_vec_pretty(
                &json!({"kind":"sandbox","position_setup":"sandbox code/state seeding","prices":"Simulated","sourceWasm":source,"result":output,"raw":raw}),
            )?,
        )?;
        // A second request at the same policy bounds is rejected by cooldown, without spending.
        let rejected: Value = watcher
            .call(account.id(), "request_repay")
            .args_json(json!({"amount":"1"}))
            .gas(Gas::from_tgas(300))
            .transact()
            .await?
            .json()?;
        assert_eq!(rejected["reason"], "cooldown");
        if !fee_failure {
            worker.fast_forward(1000).await?;
            call(owner,&account,"set_policy",json!({"policy":{"max_per_action":"5000000","lifetime_cap":"10000000","reserve_floor":"100","trigger_hf_bps":1000000,"target_hf_bps":null,"cooldown_sec":300,"action_fee":"100"}}),NearToken::from_yoctonear(1)).await?;
            encoded_call(
                owner,
                encodings::transfer_call(
                    debt.id().as_str(),
                    account.id().as_str(),
                    5_000_000,
                    "{\"reserve\":{}}",
                )?,
            )
            .await?;
            let overpay: Value = watcher
                .call(account.id(), "request_repay")
                .args_json(json!({"amount":"5000000"}))
                .gas(Gas::from_tgas(300))
                .transact()
                .await?
                .json()?;
            assert_eq!(overpay["used"], "5000000");
            let p = position(lending, account.as_account()).await?;
            assert_eq!(p["borrowed"], json!([]));
            assert_eq!(p["supplied"][0]["balance"], "1000000000000000000");
            let reserve: Value = account.view("get_reserve").await?.json()?;
            assert_eq!(reserve["spent_total"], "6000200");
            println!(
                "Guardian {}: accepted overpay counted as spend; surplus separately supplied",
                source["version"]
            );
        }
        println!(
            "Guardian {} fee_failure={fee_failure}: {output}, {} gas burnt",
            source["version"],
            outcome.total_gas_burnt.as_gas()
        );
    }
    Ok(())
}

fn verify_wasm(wasm: &[u8], metadata: &Value) -> Result<()> {
    let sha256 = format!("{:x}", Sha256::digest(wasm));
    if metadata["sha256"].as_str() != Some(sha256.as_str()) {
        bail!("Rhea WASM SHA-256 does not match recorded provenance");
    }
    Ok(())
}

#[test]
fn wasm_provenance_rejects_modified_code() -> Result<()> {
    let metadata: Value =
        serde_json::from_slice(&std::fs::read(target("probes/rhea-testnet.json"))?)?;
    let mut wasm = std::fs::read(target("probes/rhea-testnet.wasm"))?;
    verify_wasm(&wasm, &metadata)?;
    wasm[8] ^= 1;
    assert!(verify_wasm(&wasm, &metadata).is_err());
    Ok(())
}

async fn call(
    signer: &Account,
    contract: &Contract,
    method: &str,
    args: Value,
    deposit: NearToken,
) -> Result<Value> {
    let result = signer
        .call(contract.id(), method)
        .args_json(args)
        .deposit(deposit)
        .max_gas()
        .transact()
        .await?;
    if !result.failures().is_empty() {
        bail!("{method}: {:?}", result.failures());
    }
    Ok(result.json().unwrap_or(Value::Null))
}
async fn position(lending: &Contract, account: &Account) -> Result<Value> {
    Ok(lending
        .view("get_account")
        .args_json(json!({"account_id":account.id()}))
        .await?
        .json()?)
}
async fn balance(token: &Contract, account: &Account) -> Result<u128> {
    let v: String = token
        .view("ft_balance_of")
        .args_json(json!({"account_id":account.id()}))
        .await?
        .json()?;
    Ok(v.parse()?)
}

/// Rhea exposes no scalar health view. Observe its actual risk acceptance at
/// the exact C/B = 1 boundary, then one internal debt unit on either side.
/// This is deployed behavior evidence, not a fabricated health-factor RPC.
async fn deployed_health_boundary(
    owner: &Account,
    lending: &Contract,
    debt: &Contract,
) -> Result<()> {
    let before = position(lending, owner).await?;
    let starting: u128 = before["borrowed"][0]["balance"].as_str().unwrap().parse()?;
    let boundary = 285_000_000_000_000_000_000u128;
    for delta in [boundary - starting - 1, 1] {
        call(
            owner,
            lending,
            "execute_with_pyth",
            json!({"actions":[{"Borrow":{"token_id":debt.id(),"amount":delta.to_string()}}]}),
            NearToken::from_yoctonear(1),
        )
        .await?;
    }
    let at_boundary = position(lending, owner).await?;
    assert_eq!(at_boundary["borrowed"][0]["balance"], boundary.to_string());
    let rejected = owner
        .call(lending.id(), "execute_with_pyth")
        .args_json(json!({"actions":[{"Borrow":{"token_id":debt.id(),"amount":"1"}}]}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(
        !rejected.failures().is_empty(),
        "Above-boundary borrow must fail in a receipt"
    );
    assert_eq!(position(lending, owner).await?, at_boundary);
    call(owner, lending, "execute_with_pyth", json!({"actions":[{"Repay":{"token_id":debt.id(),"amount":(boundary-starting).to_string()}}]}), NearToken::from_yoctonear(1)).await?;
    assert_eq!(
        position(lending, owner).await?["borrowed"],
        before["borrowed"]
    );
    Ok(())
}

/// Derive observed health from Rhea's emitted discount, independently of probe math.
async fn deployed_discount_health(
    worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>,
    owner: &Account,
    lending: &Contract,
    debt: &Contract,
    collateral: &Contract,
    oracle: &Contract,
    network: &str,
) -> Result<()> {
    let starting: u128 = position(lending, owner).await?["borrowed"][0]["balance"]
        .as_str()
        .unwrap()
        .parse()?;
    let measured_debt = 200_000_000_000_000_000_000u128;
    call(owner, lending, "execute_with_pyth", json!({"actions":[{"Borrow":{"token_id":debt.id(),"amount":(measured_debt-starting).to_string()}}]}), NearToken::from_yoctonear(1)).await?;
    let liquidator = worker.dev_create_account().await?;
    encoded_call(
        owner,
        encodings::storage(debt.id().as_str(), liquidator.id().as_str(), 10u128.pow(22))?,
    )
    .await?;
    call(
        owner,
        lending,
        "storage_deposit",
        json!({"account_id":liquidator.id(),"registration_only":true}),
        NearToken::from_near(1),
    )
    .await?;
    call(
        owner,
        debt,
        "mint",
        json!({"account_id":liquidator.id(),"amount":"1000000"}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    encoded_call(
        &liquidator,
        encodings::transfer_call(debt.id().as_str(), lending.id().as_str(), 1_000_000, "")?,
    )
    .await?;
    call(
        owner,
        oracle,
        "set_price",
        json!({"price_id":"11".repeat(32),"price":"300000000"}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    let before_liquidation = position(lending, owner).await?;
    assert_eq!(before_liquidation["collateral"][0]["balance"], "100000000");
    assert_eq!(
        before_liquidation["borrowed"][0]["balance"],
        measured_debt.to_string()
    );
    let result = liquidator.call(lending.id(), "execute_with_pyth")
        .args_json(json!({"actions":[{"Liquidate":{"account_id":owner.id(),"in_assets":[{"token_id":debt.id(),"amount":"1000000000000000000"}],"out_assets":[{"token_id":collateral.id(),"amount":"1"}]}}]}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(result.failures().is_empty(), "{:?}", result.failures());
    let event: Value = result
        .logs()
        .iter()
        .filter_map(|log| log.strip_prefix("EVENT_JSON:"))
        .filter_map(|log| serde_json::from_str::<Value>(log).ok())
        .find(|event| event["event"] == "liquidate")
        .context("Missing Rhea liquidation event")?;
    assert_eq!(
        event["data"][0]["liquidation_account_id"],
        owner.id().as_str()
    );
    let observed_bps = if network == "testnet" {
        // Verified 0.11.0 emits neither old_discount nor new_discount. Do not
        // manufacture an observed scalar from our own health calculation.
        assert!(event["data"][0]["old_discount"].is_null());
        println!("testnet 0.11.0 liquidation event omits discount; scalar health unobserved");
        None
    } else {
        let discount = event["data"][0]["old_discount"]
            .as_str()
            .with_context(|| format!("Missing old_discount in {event}"))?;
        let (whole, fraction) = discount
            .split_once('.')
            .context("Expected fixed-point discount")?;
        assert_eq!(whole, "0");
        assert!(fraction.len() <= 27 && fraction.bytes().all(|b| b.is_ascii_digit()));
        let scale = 10u128.pow(27);
        let discount_scaled: u128 =
            fraction.parse::<u128>()? * 10u128.pow(27 - fraction.len() as u32);
        let health_bps = (scale - 2 * discount_scaled) * 10000 / scale;
        // Shared engine vector: $3 collateral, 60%/95% ratios, 200 USDC debt.
        assert!(
            (8549..=8550).contains(&health_bps),
            "Observed health {health_bps} from discount {discount}"
        );
        println!(
            "{network} deployed old_discount {discount}, implied floored health {health_bps} bps, engine 8550 bps"
        );
        Some(health_bps)
    };
    let source: Value = serde_json::from_slice(&std::fs::read(target(&format!(
        "probes/rhea-{network}.json"
    )))?)?;
    std::fs::write(
        target(&format!("probes/health-evidence-{network}.json")),
        serde_json::to_vec_pretty(&json!({
            "kind":"sandbox", "prices":"Simulated", "sourceWasm":source,
            "fixture":"liquidation discount observation", "before":before_liquidation,
            "event":event, "observedHealthBps":observed_bps,
            "engineHealthBps":8550, "boundaryDebtInternal":"285000000000000000000",
            "boundaryEvidence":"accepted at boundary and one internal unit below; rejected one above"
        }))?,
    )?;
    assert_eq!(
        position(lending, owner).await?["borrowed"][0]["balance"],
        (measured_debt - 10u128.pow(18)).to_string()
    );
    assert_eq!(
        position(lending, owner).await?["collateral"][0]["balance"],
        "99999999"
    );
    call(
        owner,
        oracle,
        "set_price",
        json!({"price_id":"11".repeat(32),"price":"500000000"}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    encoded_call(
        owner,
        encodings::transfer_call(
            collateral.id().as_str(),
            lending.id().as_str(),
            1,
            &json!({"Execute":{"actions":[{"IncreaseCollateral":{"token_id":collateral.id()}}]}})
                .to_string(),
        )?,
    )
    .await?;
    call(owner, lending, "execute_with_pyth", json!({"actions":[{"Repay":{"token_id":debt.id(),"amount":(measured_debt-10u128.pow(18)-starting).to_string()}}]}), NearToken::from_yoctonear(1)).await?;
    assert_eq!(
        position(lending, owner).await?["borrowed"][0]["balance"],
        starting.to_string()
    );
    assert_eq!(
        position(lending, owner).await?["collateral"],
        before_liquidation["collateral"]
    );
    Ok(())
}

async fn trigger_checks(
    owner: &Account,
    probe: &Contract,
    oracle: &Contract,
    network: &str,
) -> Result<()> {
    let config = json!({"oracle_id":oracle.id(),"collateral_price_id":"11".repeat(32),"debt_price_id":"22".repeat(32),"max_price_age_sec":60,"threshold_bps":57000,"legacy_oracle":network=="testnet"});
    let mut gas = serde_json::Map::new();
    for (name, threshold, expected, reason) in [
        ("at_threshold", 57000, false, Some("trigger_not_met")),
        ("below_threshold", 57001, true, None),
    ] {
        let mut cfg = config.clone();
        cfg["threshold_bps"] = json!(threshold);
        let result = owner
            .call(probe.id(), "probe_check_trigger")
            .args_json(json!({"config":cfg}))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?;
        assert!(result.failures().is_empty(), "{:?}", result.failures());
        let burnt = result.total_gas_burnt.as_gas();
        assert!(
            burnt < 100_000_000_000_000,
            "Read-only trigger check exceeds its 100 Tgas regression budget"
        );
        gas.insert(name.into(), json!(burnt));
        let output: Value = result.json()?;
        assert_eq!(output["health_bps"], 57000);
        assert_eq!(output["triggered"], expected);
        assert_eq!(output["reason"], json!(reason));
    }
    call(
        owner,
        oracle,
        "clear_price",
        json!({"price_id":"11".repeat(32)}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    let output = call(
        owner,
        probe,
        "probe_check_trigger",
        json!({"config":config}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    assert_eq!(output["triggered"], false);
    assert_eq!(output["reason"], "stale_price");
    call(
        owner,
        oracle,
        "set_price",
        json!({"price_id":"11".repeat(32),"price":"500000000"}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    call(
        owner,
        oracle,
        "set_price_age",
        json!({"price_id":"11".repeat(32),"age_sec":61}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    let output = call(
        owner,
        probe,
        "probe_check_trigger",
        json!({"config":config}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    assert_eq!(output["triggered"], false);
    assert_eq!(output["reason"], "stale_price");
    call(
        owner,
        oracle,
        "set_price_age",
        json!({"price_id":"11".repeat(32),"age_sec":0}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    let mut wrong = config.clone();
    wrong["max_price_age_sec"] = json!(120);
    let output = call(
        owner,
        probe,
        "probe_check_trigger",
        json!({"config":wrong}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    assert_eq!(output["reason"], "invalid_config");
    std::fs::write(
        target(&format!("probes/trigger-gas-{network}.json")),
        serde_json::to_vec_pretty(&json!({"network":network,"prices":"Simulated","gas":gas}))?,
    )?;
    println!(
        "P0.4 {network}: health 57000 bps, strict threshold, null/expired prices rejected, gas {gas:?}"
    );
    Ok(())
}

async fn guardian_reserve_flow(
    worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>,
    owner: &Account,
    watcher: &Account,
    lending: &Contract,
    oracle: &Contract,
    collateral: &Contract,
    debt: &Contract,
) -> Result<()> {
    let guardian = worker
        .dev_deploy(&std::fs::read(target("near/guardian/guardian.wasm"))?)
        .await?;
    let version: String = lending.view("get_version").await?.json()?;
    let init = json!({"config":{"owner_id":owner.id(),"watcher_id":watcher.id(),"lending_id":lending.id(),"oracle_id":oracle.id(),"debt_token_id":debt.id(),"collateral_token_ids":[collateral.id()],"fee_recipient_id":owner.id(),"activation_fee":"1000","lending_version":version,"debt_extra_decimals":12,"collateral_extra_decimals":0,"collateral_price_id":"11".repeat(32),"debt_price_id":"22".repeat(32),"max_price_age_sec":60},"policy":{"max_per_action":"1000","lifetime_cap":"10000","reserve_floor":"100","trigger_hf_bps":12000,"target_hf_bps":15000,"cooldown_sec":300,"action_fee":"1"}});
    call(
        owner,
        &guardian,
        "new",
        init.clone(),
        NearToken::from_yoctonear(0),
    )
    .await?;
    guardian
        .batch()
        .delete_key(guardian.as_account().secret_key().public_key())
        .transact()
        .await?
        .into_result()?;
    assert!(guardian.view_access_keys().await?.is_empty());
    call(
        owner,
        debt,
        "storage_deposit",
        json!({"account_id":guardian.id(),"registration_only":true}),
        NearToken::from_millinear(10),
    )
    .await?;
    call(
        owner,
        debt,
        "ft_transfer_call",
        json!({"receiver_id":guardian.id(),"amount":"5000","msg":"{\"activate\":{}}"}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    let status: Value = guardian.view("get_status").await?.json()?;
    assert_eq!(status["status"], "active");
    let reserve: Value = guardian.view("get_reserve").await?.json()?;
    assert_eq!(reserve["reserve"], "4000");
    assert_eq!(balance(debt, guardian.as_account()).await?, 4000);
    let denied = watcher
        .call(guardian.id(), "owner_withdraw_reserve")
        .args_json(json!({"amount":"1"}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(denied.is_failure());
    assert_eq!(balance(debt, guardian.as_account()).await?, 4000);
    call(
        owner,
        &guardian,
        "pause",
        json!({}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    call(
        owner,
        &guardian,
        "resume",
        json!({}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    call(
        owner,
        &guardian,
        "deactivate",
        json!({}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    // Sandbox fixture only: unregister/burn the owner's test-token wallet to
    // force a real NEP-141 recipient-registration failure, then restore it.
    call(
        owner,
        debt,
        "storage_unregister",
        json!({"force":true}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    let failed = owner
        .call(guardian.id(), "owner_withdraw_reserve")
        .args_json(json!({"amount":"4000"}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(!failed.failures().is_empty());
    assert!(!failed.json::<bool>()?);
    let reserve: Value = guardian.view("get_reserve").await?.json()?;
    assert_eq!(reserve["reserve"], "4000");
    let status: Value = guardian.view("get_status").await?.json()?;
    assert!(status["in_flight"].is_null());
    assert_eq!(status["status"], "deactivated");
    assert_eq!(balance(debt, guardian.as_account()).await?, 4000);
    call(
        owner,
        debt,
        "storage_deposit",
        json!({"account_id":owner.id(),"registration_only":true}),
        NearToken::from_millinear(10),
    )
    .await?;
    call(
        owner,
        &guardian,
        "owner_withdraw_reserve",
        json!({"amount":"4000"}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    assert_eq!(balance(debt, guardian.as_account()).await?, 0);
    let reserve: Value = guardian.view("get_reserve").await?.json()?;
    assert_eq!(reserve["reserve"], "0");
    let broken = worker
        .dev_deploy(&std::fs::read(target("near/guardian/guardian.wasm"))?)
        .await?;
    let mut broken_init = init;
    broken_init["config"]["fee_recipient_id"] = json!(watcher.id());
    call(
        owner,
        &broken,
        "new",
        broken_init,
        NearToken::from_yoctonear(0),
    )
    .await?;
    call(
        owner,
        debt,
        "storage_deposit",
        json!({"account_id":broken.id(),"registration_only":true}),
        NearToken::from_millinear(10),
    )
    .await?;
    let before = balance(debt, owner).await?;
    let failed = owner
        .call(debt.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id":broken.id(),"amount":"3000","msg":"{\"activate\":{}}"}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(!failed.failures().is_empty());
    assert_eq!(failed.json::<String>()?, "0");
    assert_eq!(balance(debt, owner).await?, before);
    assert_eq!(balance(debt, broken.as_account()).await?, 0);
    let status: Value = broken.view("get_status").await?.json()?;
    assert_eq!(status["status"], "created");
    assert!(status["in_flight"].is_null());
    let reserve: Value = broken.view("get_reserve").await?.json()?;
    assert_eq!(reserve["reserve"], "0");
    Ok(())
}

async fn cycle_with_rounding(network: &str, rounding: Option<&str>) -> Result<()> {
    let metadata: Value = serde_json::from_slice(
        &std::fs::read(target(&format!("probes/rhea-{network}.json")))
            .context("Run scripts/probes/fetch-rhea-wasm.mjs first")?,
    )?;
    let rhea_wasm = std::fs::read(target(&format!("probes/rhea-{network}.wasm")))?;
    verify_wasm(&rhea_wasm, &metadata)?;
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.dev_create_account().await?;
    let attacker = worker.dev_create_account().await?;
    let fixtures = std::fs::read(target("near/probe_fixtures/probe_fixtures.wasm"))?;
    let collateral = worker.dev_deploy(&fixtures).await?;
    let debt = worker.dev_deploy(&fixtures).await?;
    let oracle = worker.dev_deploy(&fixtures).await?;
    for token in [&collateral, &debt, &oracle] {
        call(
            token.as_account(),
            token,
            "new",
            json!({"owner_id":owner.id()}),
            NearToken::from_yoctonear(0),
        )
        .await?;
    }
    let lending = worker.dev_deploy(&rhea_wasm).await?;
    let mut config = metadata["config"].clone();
    config["owner_id"] = json!(owner.id());
    config["pyth_oracle_account_id"] = json!(oracle.id());
    config["oracle_account_id"] = json!(oracle.id());
    config["booster_token_id"] = json!(debt.id());
    config["max_num_assets"] = json!(20);
    call(
        &owner,
        &lending,
        "new",
        json!({"config": config}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    let version: String = lending.view("get_version").await?.json()?;
    assert_eq!(version, metadata["version"].as_str().unwrap());
    for (token, ratio, extra, price_id) in [
        (&collateral, 6000, 0, "11".repeat(32)),
        (&debt, 9500, 12, "22".repeat(32)),
    ] {
        let mut asset = metadata["assetTemplate"].clone();
        asset["can_deposit"] = json!(true);
        asset["can_withdraw"] = json!(true);
        asset["can_use_as_collateral"] = json!(true);
        asset["can_borrow"] = json!(true);
        asset["extra_decimals"] = json!(extra);
        asset["volatility_ratio"] = json!(ratio);
        asset["net_tvl_multiplier"] = json!(10000);
        asset["supplied_limit"] = json!(u128::MAX.to_string());
        asset["borrowed_limit"] = json!(u128::MAX.to_string());
        asset["min_borrowed_amount"] = json!("1");
        if rounding.is_none() {
            asset["target_utilization_rate"] = json!("1000000000000000000000000000");
            asset["max_utilization_rate"] = json!("1000000000000000000000000000");
        }
        call(
            &owner,
            &lending,
            "add_asset",
            json!({"token_id":token.id(),"asset_config":asset}),
            NearToken::from_yoctonear(1),
        )
        .await?;
        call(&owner, &lending, "add_token_pyth_info", json!({"token_id":token.id(),"token_pyth_info":{"decimals":6,"fraction_digits":4,"price_identifier":price_id,"extra_call":null,"default_price":null}}), NearToken::from_yoctonear(1)).await?;
        call(
            &owner,
            &oracle,
            "set_price",
            json!({"price_id":price_id,"price":if extra==0 {"500000000"} else {"100000000"}}),
            NearToken::from_yoctonear(0),
        )
        .await?;
    }
    let probe = worker
        .dev_deploy(&std::fs::read(target("near/probe/probe.wasm"))?)
        .await?;
    call(&owner, &probe, "new", json!({"owner_id":owner.id(),"lending_id":lending.id(),"collateral_token_id":collateral.id(),"debt_token_id":debt.id(),"debt_extra_decimals":12,"collateral_extra_decimals":0}), NearToken::from_yoctonear(0)).await?;
    probe
        .batch()
        .delete_key(probe.as_account().secret_key().public_key())
        .transact()
        .await?
        .into_result()?;
    assert!(probe.view_access_keys().await?.is_empty());
    for token in [&collateral, &debt] {
        for account in [&owner, lending.as_account()] {
            encoded_call(
                &owner,
                encodings::storage(token.id().as_str(), account.id().as_str(), 10u128.pow(22))?,
            )
            .await?;
        }
        call(
            &owner,
            &probe,
            "probe_register",
            json!({"target_id":token.id(),"storage_deposit":"10000000000000000000000"}),
            NearToken::from_yoctonear(1),
        )
        .await?;
    }
    call(
        &owner,
        &lending,
        "storage_deposit",
        json!({"account_id":owner.id(),"registration_only":true}),
        NearToken::from_near(1),
    )
    .await?;
    call(
        &owner,
        &probe,
        "probe_register",
        json!({"target_id":lending.id(),"storage_deposit":"1000000000000000000000000"}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    assert!(!position(&lending, probe.as_account()).await?.is_null());
    // Seed real NEP-141 liquidity into the imported Rhea code.
    call(
        &owner,
        &debt,
        "mint",
        json!({"account_id":owner.id(),"amount":"2000000000"}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    call(
        &owner,
        &debt,
        "ft_transfer_call",
        json!({"receiver_id":lending.id(),"amount":"1000000000","msg":""}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    call(
        &owner,
        &collateral,
        "mint",
        json!({"account_id":owner.id(),"amount":"300000000"}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    if let Some(case) = rounding {
        return rounding_flow::run(
            &worker, &owner, &attacker, [&lending, &collateral, &debt, &oracle],
            &metadata, case,
        ).await;
    }
    call(
        &owner,
        &collateral,
        "ft_transfer_call",
        json!({"receiver_id":probe.id(),"amount":"100000000","msg":""}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    call(
        &owner,
        &probe,
        "probe_supply_collateral",
        json!({"amount":"100000000"}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    let supplied = position(&lending, probe.as_account()).await?;
    assert_eq!(supplied["collateral"][0]["balance"], "100000000");
    call(
        &owner,
        &probe,
        "probe_borrow",
        json!({"amount":"50000000"}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    let borrowed = position(&lending, probe.as_account()).await?;
    assert_eq!(borrowed["borrowed"][0]["balance"], "50000000000000000000");
    assert_eq!(balance(&debt, probe.as_account()).await?, 50_000_000);
    assert_eq!(position(&lending, &owner).await?["borrowed"], json!([]));
    trigger_checks(&owner, &probe, &oracle, network).await?;
    // Missing owner check would allow this call and reduce probe debt.
    let before = position(&lending, probe.as_account()).await?;
    let rejected = attacker
        .call(probe.id(), "probe_repay")
        .args_json(json!({"amount":"1"}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(rejected.is_failure());
    assert!(format!("{:?}", rejected.failures()).contains("Owner only"));
    assert_eq!(position(&lending, probe.as_account()).await?, before);
    let forged = owner
        .call(probe.id(), "on_result")
        .args_json(json!({"op_id":0,"operation":"repay"}))
        .max_gas()
        .transact()
        .await?;
    assert!(forged.is_failure());
    assert!(format!("{:?}", forged.failures()).contains("private"));
    // Owner opens a different debt: OnlyRepay from probe must not touch it.
    call(&owner, &collateral, "ft_transfer_call", json!({"receiver_id":lending.id(),"amount":"100000000","msg":format!("{{\"Execute\":{{\"actions\":[{{\"IncreaseCollateral\":{{\"token_id\":\"{}\"}}}}]}}}}",collateral.id())}), NearToken::from_yoctonear(1)).await?;
    call(&owner, &lending, "execute_with_pyth", json!({"actions":[{"Borrow":{"token_id":debt.id(),"amount":"10000000000000000001"}},{"Withdraw":{"token_id":debt.id(),"amount":"10000000000000000000"}}]}), NearToken::from_yoctonear(1)).await?;
    let owner_before = position(&lending, &owner).await?;
    assert_eq!(
        owner_before["borrowed"][0]["balance"],
        "10000000000000000001"
    );
    deployed_health_boundary(&owner, &lending, &debt).await?;
    deployed_discount_health(
        &worker,
        &owner,
        &lending,
        &debt,
        &collateral,
        &oracle,
        network,
    )
    .await?;
    let owner_before = position(&lending, &owner).await?;
    if network == "testnet" {
        let before = position(&lending, probe.as_account()).await?;
        let rejected = owner
            .call(probe.id(), "probe_repay")
            .args_json(json!({"amount":"50000000"}))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?;
        let failures = format!("{:?}", rejected.failures());
        assert!(
            failures.contains("unknown variant `OnlyRepay`"),
            "{failures}"
        );
        assert_eq!(position(&lending, probe.as_account()).await?, before);
        assert_eq!(balance(&debt, probe.as_account()).await?, 50_000_000);
        let resolved: Value = rejected.json()?;
        assert_eq!(resolved["used"], "0");
    }
    // A partial repayment must leave exactly the remaining internal debt and
    // outer atomic wallet balance before the final contract-owned repayment.
    let partial = call(
        &owner,
        &probe,
        if network == "testnet" {
            "probe_repay_via_execute"
        } else {
            "probe_repay"
        },
        json!({"amount":"20000000"}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    assert_eq!(partial["used"], "20000000");
    assert_eq!(
        position(&lending, probe.as_account()).await?["borrowed"][0]["balance"],
        "30000000000000000000"
    );
    assert_eq!(balance(&debt, probe.as_account()).await?, 30_000_000);
    let repaid = call(
        &owner,
        &probe,
        if network == "testnet" {
            "probe_repay_via_execute"
        } else {
            "probe_repay"
        },
        json!({"amount":"30000000"}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    assert_eq!(repaid["receipt_succeeded"], true);
    assert_eq!(repaid["used"], "30000000");
    assert_eq!(
        position(&lending, probe.as_account()).await?["borrowed"],
        json!([])
    );
    assert_eq!(
        position(&lending, &owner).await?["borrowed"],
        owner_before["borrowed"]
    );
    {
        let supplied_before: u128 = owner_before["supplied"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["token_id"] == debt.id().as_str())
            .unwrap()["balance"]
            .as_str()
            .unwrap()
            .parse()?;
        let wallet_before = balance(&debt, &owner).await?;
        let used = encoded_call(
            &owner,
            encodings::repay(
                debt.id().as_str(),
                lending.id().as_str(),
                10_000_001,
                &version,
                12,
            )?,
        )
        .await?;
        println!("{network} dust resolver used: {used}");
        let after = position(&lending, &owner).await?;
        assert_eq!(after["borrowed"], json!([]));
        let supplied_after: u128 = after["supplied"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["token_id"] == debt.id().as_str())
            .unwrap()["balance"]
            .as_str()
            .unwrap()
            .parse()?;
        assert_eq!(supplied_after, supplied_before + 999_999_999_999);
        assert_eq!(used, "10000001");
        assert_eq!(balance(&debt, &owner).await?, wallet_before - 10_000_001);
    }
    call(
        &owner,
        &probe,
        "probe_release",
        json!({"amount":"100000000"}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    let before_fee = balance(&debt, probe.as_account()).await?;
    encoded_call(
        &owner,
        encodings::transfer(debt.id().as_str(), probe.id().as_str(), 100_000)?,
    )
    .await?;
    assert_eq!(
        balance(&debt, probe.as_account()).await?,
        before_fee + 100_000
    );
    assert_eq!(
        position(&lending, probe.as_account()).await?["collateral"],
        json!([])
    );
    assert_eq!(balance(&collateral, probe.as_account()).await?, 100_000_000);
    guardian_reserve_flow(
        &worker,
        &owner,
        &attacker,
        &lending,
        &oracle,
        &collateral,
        &debt,
    )
    .await?;
    record_outcomes(
        &worker, &owner, &attacker, &lending, &debt, &oracle, &metadata,
    )
    .await?;
    composed_probe_checks(
        &worker,
        &owner,
        &attacker,
        [&lending, &collateral, &debt, &oracle],
        &metadata,
    )
    .await?;
    guardian_imported_checks(
        &worker,
        &owner,
        &attacker,
        [&lending, &collateral, &debt, &oracle],
        &metadata,
    )
    .await?;
    position_flow::lifecycle(
        &worker,
        &owner,
        &attacker,
        [&lending, &collateral, &debt, &oracle],
        &metadata,
    )
    .await?;
    println!(
        "P0.3 {network} WASM {version}: full contract-owned cycle, owner isolation and cross-account repay isolation passed; P2.2 Guardian activation and deactivated reserve withdrawal passed; prices Simulated; source block {}",
        metadata["blockHeight"]
    );
    Ok(())
}
async fn cycle(network: &str) -> Result<()> {
    cycle_with_rounding(network, None).await
}

#[tokio::test]
async fn guardian_accrued_borrow() -> Result<()> {
    cycle_with_rounding("testnet", Some("borrow")).await
}

#[tokio::test]
async fn guardian_accrued_release() -> Result<()> {
    cycle_with_rounding("testnet", Some("release")).await
}

#[tokio::test]
async fn guardian_accrued_surplus_then_borrow() -> Result<()> {
    cycle_with_rounding("testnet", Some("surplus")).await
}


#[tokio::test]
async fn probe_testnet_wasm_cycle() -> Result<()> {
    cycle("testnet").await
}

#[tokio::test]
async fn guardian_controlled_refund_fixtures() -> Result<()> {
    // Controlled receiver proves accounting, not deployed Rhea repayment semantics.
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.dev_create_account().await?;
    let fixture_wasm = std::fs::read(target("near/probe_fixtures/probe_fixtures.wasm"))?;
    for version in ["0.11.0", "0.16.2"] {
        for refund_percent in [50, 100] {
            let debt = worker.dev_deploy(&fixture_wasm).await?;
            let lending = worker.dev_deploy(&fixture_wasm).await?;
            let guardian = worker
                .dev_deploy(&std::fs::read(target("near/guardian/guardian.wasm"))?)
                .await?;
            for fixture in [&debt, &lending] {
                call(
                    &owner,
                    fixture,
                    "new",
                    json!({"owner_id":owner.id()}),
                    NearToken::from_yoctonear(0),
                )
                .await?;
            }
            call(&owner,&lending,"set_guardian_fixture",json!({"config":{"guardian":guardian.id(),"debt":debt.id(),"collateral":"collateral.test.near","version":version,"refund_percent":refund_percent}}),NearToken::from_yoctonear(0)).await?;
            for (feed, price) in [
                ("11".repeat(32), "500000000"),
                ("22".repeat(32), "100000000"),
            ] {
                call(
                    &owner,
                    &lending,
                    "set_price",
                    json!({"price_id":feed,"price":price}),
                    NearToken::from_yoctonear(0),
                )
                .await?;
            }
            let init = json!({"config":{"owner_id":owner.id(),"watcher_id":owner.id(),"lending_id":lending.id(),"oracle_id":lending.id(),"debt_token_id":debt.id(),"collateral_token_ids":["collateral.test.near"],"fee_recipient_id":owner.id(),"activation_fee":"0","lending_version":version,"debt_extra_decimals":0,"collateral_extra_decimals":0,"collateral_price_id":"11".repeat(32),"debt_price_id":"22".repeat(32),"max_price_age_sec":60},"policy":{"max_per_action":"100","lifetime_cap":"1000","reserve_floor":"20","trigger_hf_bps":12000,"target_hf_bps":15000,"cooldown_sec":300,"action_fee":"1"}});
            call(&owner, &guardian, "new", init, NearToken::from_yoctonear(0)).await?;
            for account in [owner.id(), guardian.id(), lending.id()] {
                call(
                    &owner,
                    &debt,
                    "storage_deposit",
                    json!({"account_id":account}),
                    NearToken::from_near(1),
                )
                .await?;
            }
            call(
                &owner,
                &debt,
                "mint",
                json!({"account_id":owner.id(),"amount":"121"}),
                NearToken::from_yoctonear(0),
            )
            .await?;
            encoded_call(
                &owner,
                encodings::transfer_call(
                    debt.id().as_str(),
                    guardian.id().as_str(),
                    121,
                    "{\"activate\":{}}",
                )?,
            )
            .await?;
            let result = owner
                .call(guardian.id(), "request_repay")
                .args_json(json!({"amount":"100"}))
                .gas(Gas::from_tgas(300))
                .transact()
                .await?;
            assert!(result.failures().is_empty(), "{:?}", result.failures());
            let output: Value = result.json()?;
            let used = 100 - refund_percent;
            let fee = u128::from(used > 0);
            assert_eq!(
                output["outcome"],
                if used > 0 { "executed" } else { "failed" }
            );
            let reserve: Value = guardian.view("get_reserve").await?.json()?;
            assert_eq!(reserve["reserve"], (121 - used - fee).to_string());
            assert_eq!(reserve["spent_total"], (used + fee).to_string());
            assert_eq!(
                balance(&debt, guardian.as_account()).await?,
                121 - used - fee
            );
            let history: Value = guardian
                .view("get_history")
                .args_json(json!({"from":0,"limit":50}))
                .await?
                .json()?;
            assert_eq!(history[0]["used"], used.to_string());
            assert_eq!(history[0]["fee"], fee.to_string());
            let status: Value = guardian.view("get_status").await?.json()?;
            assert!(status["in_flight"].is_null());
            println!("Controlled Guardian {version} refund={refund_percent}%: {output}");
        }
    }
    Ok(())
}

#[tokio::test]
async fn probe_mainnet_wasm_cycle() -> Result<()> {
    cycle("mainnet").await
}
