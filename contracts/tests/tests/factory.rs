//! Tasks 3.1-3.3: the real factory in the pinned sandbox (local state only; no
//! public network). Failure phases are driven through the actual protocol: an
//! under-funded batch, an id that already exists, out-of-range funding and a
//! concurrent duplicate. Run with `-- --nocapture` to see the measurements recorded
//! in docs/technical/SMART-CONTRACT.md.
use anyhow::Result;
use near_workspaces::{
    types::{AccountDetailsPatch, Gas, NearToken},
    Account, AccountId, Contract,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

type Sandbox = near_workspaces::Worker<near_workspaces::network::Sandbox>;
const BYTE_COST: u128 = 10_000_000_000_000_000_000;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn target(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../target")
        .join(path)
}
fn guardian_len() -> Result<u128> {
    Ok(std::fs::read(target("near/guardian/guardian.wasm"))?.len() as u128)
}
fn template() -> Value {
    json!({"watcher_id":"watcher.test","lending_id":"lending.test","oracle_id":"oracle.test","debt_token_id":"debt.test","collateral_token_id":"collateral.test","fee_recipient_id":"fees.test","activation_fee":"0","lending_version":"0.11.0","debt_extra_decimals":12,"collateral_extra_decimals":0,"collateral_price_id":"11".repeat(32),"debt_price_id":"22".repeat(32),"max_price_age_sec":60})
}
fn policy() -> Value {
    json!({"max_per_action":"1000000","lifetime_cap":"10000000","reserve_floor":"100","trigger_hf_bps":12000,"target_hf_bps":null,"cooldown_sec":300,"action_fee":"0"})
}

async fn deploy(worker: &Sandbox, min: u128, max: u128) -> Result<Contract> {
    // Child ids are 32 hex + "." + the factory id and must fit 64 characters, so the
    // factory needs a short account id (sandbox dev-* ids are too long, which the
    // factory's own init check refuses).
    let factory = worker
        .root_account()?
        .create_subaccount("f")
        .initial_balance(NearToken::from_near(60))
        .transact()
        .await?
        .into_result()?
        .deploy(&std::fs::read(target(
            "near/guardian_factory/guardian_factory.wasm",
        ))?)
        .await?
        .into_result()?;
    let init = factory
        .call("new")
        .args_json(json!({"template":template(),"min_funding":min.to_string(),"max_funding":max.to_string()}))
        .transact()
        .await?;
    assert!(init.is_success(), "{:?}", init.failures());
    Ok(factory)
}
async fn balance(account: &Account) -> Result<i128> {
    Ok(account.view_account().await?.balance.as_yoctonear() as i128)
}
async fn views(factory: &Contract, owner: &AccountId) -> Result<(Option<String>, String, bool)> {
    let guardian: Option<String> = factory
        .view("get_guardian")
        .args_json(json!({"owner_id":owner}))
        .await?
        .json()?;
    let next: String = factory
        .view("get_next_guardian_id")
        .args_json(json!({"owner_id":owner}))
        .await?
        .json()?;
    let pending: bool = factory
        .view("is_pending")
        .args_json(json!({"owner_id":owner}))
        .await?
        .json()?;
    Ok((guardian, next, pending))
}

struct Run {
    outcome: near_workspaces::result::ExecutionFinalResult,
    result: Option<Value>,
    owner_delta: i128,
    factory_delta: i128,
}
async fn create(
    worker: &Sandbox,
    owner: &Account,
    factory: &Contract,
    funding: u128,
    gas_tgas: u64,
) -> Result<Run> {
    let (owner_before, factory_before) =
        (balance(owner).await?, balance(factory.as_account()).await?);
    let outcome = owner
        .call(factory.id(), "create_guardian")
        .args_json(json!({"policy":policy()}))
        .deposit(NearToken::from_yoctonear(funding))
        .gas(Gas::from_tgas(gas_tgas))
        .transact()
        .await?;
    worker.fast_forward(8).await?; // let refund receipts settle
    Ok(Run {
        result: outcome.clone().json().ok(),
        owner_delta: balance(owner).await? - owner_before,
        factory_delta: balance(factory.as_account()).await? - factory_before,
        outcome,
    })
}
async fn exists(worker: &Sandbox, id: &str) -> bool {
    worker
        .view_account(&id.parse::<AccountId>().unwrap())
        .await
        .is_ok()
}

/// Gas paid for the failure itself is small; a refund must give back the deposit.
const GAS_ALLOWANCE: i128 = NEAR as i128 / 10;

#[tokio::test]
async fn creation_is_keyless_atomic_and_measured() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let floor_bound = guardian_len()? * BYTE_COST;
    let factory = deploy(&worker, floor_bound, floor_bound + 3 * NEAR).await?;
    let code_hash: Vec<u8> = factory.view("get_code_hash").await?.json()?;
    assert_eq!(
        code_hash,
        Sha256::digest(std::fs::read(target("near/guardian/guardian.wasm"))?).to_vec(),
        "the factory embeds the prepared Guardian build"
    );
    let factory_storage = factory.view_account().await?.storage_usage;
    println!(
        "guardian_bytes={} factory_storage_bytes={} factory_locked_yocto={}",
        guardian_len()?,
        factory_storage,
        u128::from(factory_storage) * BYTE_COST
    );

    // A generous creation: keyless, embedded code, template config, mapping published.
    let alice = worker.dev_create_account().await?;
    let planned = views(&factory, alice.id()).await?.1;
    let run = create(&worker, &alice, &factory, floor_bound + NEAR, 150).await?;
    assert!(
        run.outcome.failures().is_empty(),
        "{:?}",
        run.outcome.failures()
    );
    println!(
        "gas create_guardian (all receipts): {} Tgas",
        run.outcome.total_gas_burnt.as_gas() / 1_000_000_000_000
    );
    let result = run.result.expect("outcome");
    assert_eq!(result["outcome"], "created");
    assert_eq!(result["guardian_id"], planned.as_str());
    let child: AccountId = planned.parse()?;
    assert!(
        worker.view_access_keys(&child).await?.is_empty(),
        "I10: keyless child"
    );
    let detail = worker.view_account(&child).await?;
    println!("contract_state={:?}", detail.contract_state);
    assert!(format!("{:?}", detail.contract_state).contains("Local"));
    let status: Value = worker.view(&child, "get_status").await?.json()?;
    assert_eq!(status["owner_id"], alice.id().as_str());
    assert_eq!(status["status"], "created");
    assert_eq!(status["lending_id"], "lending.test");
    let config: Value = worker.view(&child, "get_config").await?.json()?;
    assert_eq!(config["activation_fee"], "0");
    assert_eq!(config["max_price_age_sec"], 60);
    let (published, next, pending) = views(&factory, alice.id()).await?;
    assert_eq!(published.as_deref(), Some(planned.as_str()));
    assert_ne!(next, planned, "the nonce advanced");
    assert!(!pending);
    let owner_of: Option<String> = factory
        .view("get_owner")
        .args_json(json!({"guardian_id":child}))
        .await?
        .json()?;
    assert_eq!(owner_of.as_deref(), Some(alice.id().as_str()));
    assert_eq!(
        factory_delta_tolerance(run.factory_delta),
        0,
        "the factory keeps nothing"
    );

    // The same owner can create another Guardian (a new nonce, a new id).
    let again = create(&worker, &alice, &factory, floor_bound + NEAR, 150).await?;
    assert_eq!(again.result.expect("outcome")["guardian_id"], next.as_str());

    // Exact measured floor for this Guardian build: the child's storage after init.
    let measured = u128::from(detail.storage_usage) * BYTE_COST;
    println!(
        "measured_creation_floor_yocto={measured} (storage {} B)",
        detail.storage_usage
    );
    assert!(
        measured > floor_bound,
        "the protocol floor exceeds the code-only bound"
    );

    // The factory's lower bound is code storage only, so a deposit at that bound is
    // under-funded for the real child. The protocol rejects it; nothing is created.
    let bob = worker.dev_create_account().await?;
    let bob_next = views(&factory, bob.id()).await?.1;
    let under = create(&worker, &bob, &factory, measured - 1, 150).await?;
    // The batch receipt fails (that is the point) but the callback handled it, so
    // the transaction itself ends in success and reports a Failed outcome.
    assert!(under.outcome.is_success(), "{:?}", under.outcome);
    let reason = format!("{:?}", under.outcome.failures());
    println!(
        "under-funded protocol error: {}",
        &reason[..reason.len().min(600)]
    );
    assert!(reason.contains("LackBalanceForState"), "{reason}");
    println!("under-funded outcome: {:?}", under.result);
    assert_eq!(under.result.as_ref().unwrap()["outcome"], "failed");
    assert_eq!(under.result.as_ref().unwrap()["refund"], "sent");
    assert!(!exists(&worker, &bob_next).await, "atomic: no child");
    assert!(
        under.owner_delta > -GAS_ALLOWANCE,
        "deposit returned, owner lost {} yocto",
        under.owner_delta
    );
    assert!(
        factory_delta_tolerance(under.factory_delta) == 0,
        "factory delta {}",
        under.factory_delta
    );
    let (published, next_again, pending) = views(&factory, bob.id()).await?;
    assert_eq!(
        (published, next_again, pending),
        (None, bob_next.clone(), false)
    );
    let at_floor = create(&worker, &bob, &factory, measured, 150).await?;
    assert_eq!(at_floor.result.as_ref().unwrap()["outcome"], "created");
    assert_eq!(
        worker
            .view_account(&bob_next.parse::<AccountId>()?)
            .await?
            .balance
            .as_yoctonear(),
        measured
    );
    Ok(())
}

/// Gas dust on the factory (callbacks are paid from the signer's prepaid gas) is
/// zero; keep the helper explicit so a stray balance change shows up in the output.
fn factory_delta_tolerance(delta: i128) -> i128 {
    if delta.abs() < 1_000_000_000_000_000_000_000 {
        0
    } else {
        delta
    }
}

#[tokio::test]
async fn rejections_and_failures_return_the_deposit_and_leave_no_state() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let floor_bound = guardian_len()? * BYTE_COST;
    let (min, max) = (floor_bound + NEAR, floor_bound + 2 * NEAR);
    let factory = deploy(&worker, min, max).await?;
    let alice = worker.dev_create_account().await?;
    let next = views(&factory, alice.id()).await?.1;

    // Out-of-range funding, too little gas and an invalid policy are refused up
    // front: the transaction fails and the attached deposit comes straight back.
    for (funding, gas) in [(0, 150), (min - 1, 150), (max + 1, 150), (min, 100)] {
        let run = create(&worker, &alice, &factory, funding, gas).await?;
        assert!(run.outcome.is_failure(), "funding {funding} gas {gas}");
        assert!(
            run.owner_delta > -GAS_ALLOWANCE,
            "deposit returned: {}",
            run.owner_delta
        );
        assert!(!exists(&worker, &next).await);
        assert_eq!(
            views(&factory, alice.id()).await?,
            (None, next.clone(), false)
        );
    }
    let bad_policy = alice
        .call(factory.id(), "create_guardian")
        .args_json(json!({"policy":{"max_per_action":"1","lifetime_cap":"1","reserve_floor":"0","trigger_hf_bps":10499,"target_hf_bps":null,"cooldown_sec":300,"action_fee":"0"}}))
        .deposit(NearToken::from_yoctonear(min))
        .max_gas()
        .transact()
        .await?;
    assert!(bad_policy.is_failure());
    assert!(format!("{:?}", bad_policy.failures()).contains("Trigger below minimum"));

    // An id that already exists: the batch fails after being scheduled, so the
    // whole deposit returns through the callback and the owner can retry.
    worker
        .patch(&next.parse::<AccountId>()?)
        .account(AccountDetailsPatch::default().balance(NearToken::from_near(1)))
        .transact()
        .await?;
    let collided = create(&worker, &alice, &factory, min, 150).await?;
    assert_eq!(collided.result.as_ref().unwrap()["outcome"], "failed");
    assert_eq!(collided.result.as_ref().unwrap()["phase"], "create_batch");
    assert_eq!(collided.result.as_ref().unwrap()["refund"], "sent");
    assert!(
        collided.owner_delta > -GAS_ALLOWANCE,
        "{}",
        collided.owner_delta
    );
    assert!(factory_delta_tolerance(collided.factory_delta) == 0);
    assert_eq!(views(&factory, alice.id()).await?, (None, next, false));
    let unclaimed: String = factory
        .view("get_unclaimed")
        .args_json(json!({"owner_id":alice.id()}))
        .await?
        .json()?;
    assert_eq!(unclaimed, "0");
    Ok(())
}

#[tokio::test]
async fn concurrent_duplicate_creation_is_refused_without_a_second_child() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let floor_bound = guardian_len()? * BYTE_COST;
    let (min, max) = (floor_bound + NEAR, floor_bound + 2 * NEAR);
    let factory = deploy(&worker, min, max).await?;
    let alice = worker.dev_create_account().await?;
    let call = || {
        alice
            .call(factory.id(), "create_guardian")
            .args_json(json!({"policy":policy()}))
            .deposit(NearToken::from_yoctonear(min))
            .gas(Gas::from_tgas(150))
            .transact_async()
    };
    let (first, second) = (call().await?, call().await?);
    let (first, second) = (first.await?, second.await?);
    let outcomes = [first, second];
    let created = outcomes.iter().filter(|o| o.is_success()).count();
    let refused = outcomes
        .iter()
        .filter(|o| format!("{:?}", o.failures()).contains("Creation in flight"))
        .count();
    println!("created={created} refused_in_flight={refused}");
    assert_eq!(
        (created, refused),
        (1, 1),
        "exactly one child; the duplicate is refused"
    );
    worker.fast_forward(8).await?;
    let (published, _, pending) = views(&factory, alice.id()).await?;
    assert!(published.is_some() && !pending);
    Ok(())
}

#[tokio::test]
async fn callbacks_and_claims_cannot_be_forged() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let floor_bound = guardian_len()? * BYTE_COST;
    let factory = deploy(&worker, floor_bound + NEAR, floor_bound + 2 * NEAR).await?;
    let attacker = worker.dev_create_account().await?;
    for (method, args) in [
        (
            "on_guardian_created",
            json!({"owner_id":attacker.id(),"guardian_id":format!("x.{}", factory.id()),"deposit":"1"}),
        ),
        (
            "on_refund_resolved",
            json!({"owner_id":attacker.id(),"amount":"1"}),
        ),
        (
            "on_claim_resolved",
            json!({"owner_id":attacker.id(),"amount":"1"}),
        ),
    ] {
        let outcome = attacker
            .call(factory.id(), method)
            .args_json(args)
            .max_gas()
            .transact()
            .await?;
        assert!(outcome.is_failure(), "{method}");
        assert!(
            format!("{:?}", outcome.failures()).contains("private"),
            "{method}"
        );
    }
    // Nothing to claim, and no claim without exactly 1 yocto.
    for deposit in [1u128, 0] {
        let outcome = attacker
            .call(factory.id(), "claim_refund")
            .deposit(NearToken::from_yoctonear(deposit))
            .max_gas()
            .transact()
            .await?;
        assert!(outcome.is_failure());
    }
    Ok(())
}
