//! Tasks 2.2/2.3/4.1: a keyless Guardian runs the full owner lifecycle against the
//! imported Rhea code. Prices are Simulated fixtures; this is local sandbox state,
//! not a public deployment. Every step reads back token balances and the Rhea
//! position instead of trusting the immediate promise result.
use super::*;

const COLLATERAL: u128 = 100_000_000;
const BORROW: u128 = 50_000_000;
const EXTRA: u128 = 1_000_000_000_000;

async fn rejected(
    caller: &Account,
    guardian: &Contract,
    method: &str,
    args: Value,
    deposit: u128,
    expected: &str,
) -> Result<()> {
    let outcome = caller
        .call(guardian.id(), method)
        .args_json(args)
        .deposit(NearToken::from_yoctonear(deposit))
        .max_gas()
        .transact()
        .await?;
    assert!(
        outcome.is_failure(),
        "{method} by {} must fail",
        caller.id()
    );
    let failures = format!("{:?}", outcome.failures());
    assert!(failures.contains(expected), "{method}: {failures}");
    Ok(())
}

async fn owner_call(
    owner: &Account,
    guardian: &Contract,
    method: &str,
    args: Value,
) -> Result<near_workspaces::result::ExecutionFinalResult> {
    let outcome = owner
        .call(guardian.id(), method)
        .args_json(args)
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(
        outcome.failures().is_empty(),
        "{method}: {:?}",
        outcome.failures()
    );
    println!(
        "gas {method}: {} Tgas",
        outcome.total_gas_burnt.as_gas() / 1_000_000_000_000
    );
    Ok(outcome)
}

fn logged(outcome: &near_workspaces::result::ExecutionFinalResult, event: &str) -> bool {
    outcome
        .logs()
        .iter()
        .any(|log| log.contains(&format!("\"event\":\"{event}\"")))
}

async fn reserve(guardian: &Contract) -> Result<String> {
    let view: Value = guardian.view("get_reserve").await?.json()?;
    Ok(view["reserve"].as_str().unwrap().to_owned())
}

async fn idle(guardian: &Contract) -> Result<()> {
    let status: Value = guardian.view("get_status").await?.json()?;
    assert!(status["in_flight"].is_null(), "lock released: {status}");
    Ok(())
}

pub async fn lifecycle(
    worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>,
    owner: &Account,
    watcher: &Account,
    targets: [&Contract; 4],
    source: &Value,
) -> Result<()> {
    let [lending, collateral, debt, oracle] = targets;
    // Provision through the factory: the Guardian is created keyless with the
    // template config and the owner's policy, never seeded by patching state.
    let guardian_len = std::fs::read(target("near/guardian/guardian.wasm"))?.len() as u128;
    let min_funding = guardian_len * 10_000_000_000_000_000_000;
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
    let template = json!({"watcher_id":watcher.id(),"lending_id":lending.id(),"oracle_id":oracle.id(),"debt_token_id":debt.id(),"collateral_token_id":collateral.id(),"fee_recipient_id":owner.id(),"activation_fee":"0","lending_version":source["version"],"debt_extra_decimals":12,"collateral_extra_decimals":0,"collateral_price_id":"11".repeat(32),"debt_price_id":"22".repeat(32),"max_price_age_sec":60});
    call(
        factory.as_account(),
        &factory,
        "new",
        json!({"template":template,"min_funding":min_funding.to_string(),"max_funding":(min_funding + 6 * 10u128.pow(24)).to_string()}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    let policy = json!({"max_per_action":"1000000","lifetime_cap":"10000000","reserve_floor":"100","trigger_hf_bps":12000,"target_hf_bps":null,"cooldown_sec":300,"action_fee":"0"});
    let created = owner
        .call(factory.id(), "create_guardian")
        .args_json(json!({"policy":policy}))
        .deposit(NearToken::from_millinear(4500))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?;
    assert!(created.failures().is_empty(), "{:?}", created.failures());
    println!(
        "gas create_guardian: {} Tgas",
        created.total_gas_burnt.as_gas() / 1_000_000_000_000
    );
    let outcome: Value = created.json()?;
    assert_eq!(outcome["outcome"], "created");
    // A handle for views and balances only; the keyless account never signs.
    let guardian = Contract::from_secret_key(
        outcome["guardian_id"].as_str().unwrap().parse()?,
        near_workspaces::types::SecretKey::from_random(near_workspaces::types::KeyType::ED25519),
        worker,
    );
    assert!(
        guardian.view_access_keys().await?.is_empty(),
        "I10 before use"
    );

    // Negative: the watcher (a different account), missing yocto, a forged callback.
    for (method, args) in [
        (
            "owner_register",
            json!({"target_id":lending.id(),"storage_deposit":"1"}),
        ),
        ("owner_borrow", json!({"amount":"1"})),
        ("owner_withdraw_collateral", json!({"amount":"1"})),
        ("owner_repay_from_reserve", json!({"amount":"1"})),
        ("owner_sweep", json!({"token_id":debt.id()})),
    ] {
        rejected(watcher, &guardian, method, args.clone(), 1, "Owner only").await?;
        rejected(owner, &guardian, method, args, 0, "1 yocto").await?;
    }
    rejected(
        owner,
        &guardian,
        "on_position_resolved",
        json!({"op_id":0}),
        0,
        "private",
    )
    .await?;
    rejected(
        owner,
        &guardian,
        "owner_register",
        json!({"target_id":oracle.id(),"storage_deposit":"1"}),
        1,
        "Unsupported registration target",
    )
    .await?;

    // Registration is paid from the Guardian's own NEAR and limited to the three targets.
    for (target_id, deposit) in [
        (lending.id(), "1000000000000000000000000"),
        (collateral.id(), "10000000000000000000000"),
        (debt.id(), "10000000000000000000000"),
    ] {
        let before = guardian.view_account().await?.balance.as_yoctonear();
        let outcome = owner_call(
            owner,
            &guardian,
            "owner_register",
            json!({"target_id":target_id,"storage_deposit":deposit}),
        )
        .await?;
        assert!(logged(&outcome, "position_operation_succeeded"));
        // Rhea and the tokens refund the excess of a registration-only deposit, so
        // the net cost is the counterparty's real storage minimum, not `deposit`.
        let after = guardian.view_account().await?.balance.as_yoctonear();
        println!(
            "registration {target_id}: offered {deposit}, net cost {} yocto",
            before.saturating_sub(after)
        );
        idle(&guardian).await?;
    }
    assert!(!position(lending, guardian.as_account()).await?.is_null());

    // Collateral funding: the Guardian forwards exactly the owner's deposit.
    call(
        owner,
        collateral,
        "mint",
        json!({"account_id":owner.id(),"amount":"300000000"}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    let owner_collateral = balance(collateral, owner).await?;
    let wrong = call(
        owner,
        collateral,
        "ft_transfer_call",
        json!({"receiver_id":guardian.id(),"amount":"1","msg":"{\"reserve\":{}}"}),
        NearToken::from_yoctonear(1),
    )
    .await?;
    assert_eq!(wrong, "0", "a wrong message is refunded in full");
    assert_eq!(balance(collateral, owner).await?, owner_collateral);
    let funded = owner
        .call(collateral.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id":guardian.id(),"amount":COLLATERAL.to_string(),"msg":"{\"collateral\":{}}"}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(funded.failures().is_empty(), "{:?}", funded.failures());
    println!(
        "gas collateral funding: {} Tgas",
        funded.total_gas_burnt.as_gas() / 1_000_000_000_000
    );
    assert!(logged(&funded, "collateral_deposit_resolved"));
    assert_eq!(
        position(lending, guardian.as_account()).await?["collateral"][0]["balance"],
        COLLATERAL.to_string()
    );
    assert_eq!(balance(collateral, guardian.as_account()).await?, 0);
    assert_eq!(
        balance(collateral, owner).await?,
        owner_collateral - COLLATERAL
    );
    idle(&guardian).await?;

    // Borrow: debt tokens arrive at the Guardian and stay outside reserve accounting.
    let _ = owner_call(
        owner,
        &guardian,
        "owner_borrow",
        json!({"amount":BORROW.to_string()}),
    )
    .await?;
    assert_eq!(
        position(lending, guardian.as_account()).await?["borrowed"][0]["balance"],
        (BORROW * EXTRA).to_string()
    );
    assert_eq!(balance(debt, guardian.as_account()).await?, BORROW);
    assert_eq!(reserve(&guardian).await?, "0");
    idle(&guardian).await?;

    // Reserve funding, then sweep: only the balance above the reserve moves.
    call(
        owner,
        debt,
        "mint",
        json!({"account_id":owner.id(),"amount":"200000000"}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    encoded_call(
        owner,
        encodings::transfer_call(
            debt.id().as_str(),
            guardian.id().as_str(),
            10_000_000,
            "{\"reserve\":{}}",
        )?,
    )
    .await?;
    assert_eq!(reserve(&guardian).await?, "10000000");
    let owner_debt = balance(debt, owner).await?;
    let swept = owner_call(
        owner,
        &guardian,
        "owner_sweep",
        json!({"token_id":debt.id()}),
    )
    .await?;
    assert!(logged(&swept, "swept"));
    assert_eq!(balance(debt, owner).await?, owner_debt + BORROW);
    assert_eq!(balance(debt, guardian.as_account()).await?, 10_000_000);
    assert_eq!(reserve(&guardian).await?, "10000000");
    let empty = owner_call(
        owner,
        &guardian,
        "owner_sweep",
        json!({"token_id":debt.id()}),
    )
    .await?;
    assert!(logged(&empty, "sweep_skipped"));
    assert_eq!(balance(debt, guardian.as_account()).await?, 10_000_000);
    idle(&guardian).await?;

    // Manual repayment from reserve: debt falls by the accepted amount, no fee.
    let repaid = owner_call(
        owner,
        &guardian,
        "owner_repay_from_reserve",
        json!({"amount":"10000000"}),
    )
    .await?;
    assert!(logged(&repaid, "manual_repay_settled"));
    assert_eq!(
        position(lending, guardian.as_account()).await?["borrowed"][0]["balance"],
        ((BORROW - 10_000_000) * EXTRA).to_string()
    );
    assert_eq!(reserve(&guardian).await?, "0");
    assert_eq!(balance(debt, guardian.as_account()).await?, 0);
    idle(&guardian).await?;
    encoded_call(
        owner,
        encodings::transfer_call(
            debt.id().as_str(),
            guardian.id().as_str(),
            40_000_000,
            "{\"reserve\":{}}",
        )?,
    )
    .await?;
    let _ = owner_call(
        owner,
        &guardian,
        "owner_repay_from_reserve",
        json!({"amount":"40000000"}),
    )
    .await?;
    assert_eq!(
        position(lending, guardian.as_account()).await?["borrowed"],
        json!([]),
        "full repayment clears the Guardian's own debt"
    );
    assert_eq!(reserve(&guardian).await?, "0");
    assert_eq!(balance(debt, guardian.as_account()).await?, 0);

    // Release collateral and sweep it back to the owner.
    let _ = owner_call(
        owner,
        &guardian,
        "owner_withdraw_collateral",
        json!({"amount":COLLATERAL.to_string()}),
    )
    .await?;
    assert_eq!(
        position(lending, guardian.as_account()).await?["collateral"],
        json!([])
    );
    assert_eq!(
        balance(collateral, guardian.as_account()).await?,
        COLLATERAL
    );
    let _ = owner_call(
        owner,
        &guardian,
        "owner_sweep",
        json!({"token_id":collateral.id()}),
    )
    .await?;
    assert_eq!(balance(collateral, owner).await?, owner_collateral);
    assert_eq!(balance(collateral, guardian.as_account()).await?, 0);
    idle(&guardian).await?;
    assert!(
        guardian.view_access_keys().await?.is_empty(),
        "I10 after the lifecycle"
    );
    Ok(())
}
