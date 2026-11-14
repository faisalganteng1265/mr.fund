use super::*;
use near_sdk::{
    mock::MockAction,
    serde_json::Value,
    test_utils::{get_created_receipts, get_logs, VMContextBuilder},
    testing_env, PromiseResult,
};

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn template() -> GuardianTemplate {
    GuardianTemplate {
        watcher_id: id("watcher.test.near"),
        lending_id: id("lending.test.near"),
        oracle_id: id("oracle.test.near"),
        debt_token_id: id("debt.test.near"),
        collateral_token_id: id("collateral.test.near"),
        fee_recipient_id: id("fees.test.near"),
        activation_fee: U128(0),
        lending_version: "0.11.0".into(),
        debt_extra_decimals: 12,
        collateral_extra_decimals: 0,
        collateral_price_id: "11".repeat(32),
        debt_price_id: "22".repeat(32),
        max_price_age_sec: 60,
    }
}
fn policy() -> Policy {
    Policy {
        max_per_action: U128(100),
        lifetime_cap: U128(1000),
        reserve_floor: U128(20),
        trigger_hf_bps: 12000,
        target_hf_bps: Some(15000),
        cooldown_sec: 300,
        action_fee: U128(1),
    }
}
fn prepared() {
    assert!(
        !GUARDIAN_CODE.is_empty(),
        "Guardian wasm missing: run pnpm contracts:probe:prepare"
    );
}
fn min() -> u128 {
    GuardianFactory::storage_floor() + 1_000
}
fn max() -> u128 {
    min() + 10u128.pow(24)
}
fn context(caller: &str, deposit: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(id("factory.test.near"))
        .predecessor_account_id(id(caller))
        .signer_account_id(id(caller))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .build());
}
fn factory() -> GuardianFactory {
    context("deployer.test.near", 0);
    GuardianFactory::new(template(), U128(min()), U128(max()))
}
fn callback(result: PromiseResult) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(id("factory.test.near"))
            .predecessor_account_id(id("factory.test.near"))
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}
fn refused<R>(operation: impl FnOnce() -> R) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(operation)).is_err()
}
fn create(f: &mut GuardianFactory, owner: &str, deposit: u128) {
    context(owner, deposit);
    let _ = f.create_guardian(policy());
}
/// Starts a creation and drops its promise so the receipts are scheduled.
fn started(owner: &str) -> (GuardianFactory, AccountId) {
    prepared();
    let mut f = factory();
    let child = f.get_next_guardian_id(id(owner));
    create(&mut f, owner, min());
    (f, child)
}

#[test]
fn template_and_bounds_are_validated_at_initialization() {
    let mut bad = template();
    bad.collateral_token_id = bad.debt_token_id.clone();
    assert!(refused(|| {
        context("d.test.near", 0);
        GuardianFactory::new(bad, U128(min()), U128(max()))
    }));
    for edit in [
        |t: &mut GuardianTemplate| t.lending_version = "9.9.9".into(),
        |t: &mut GuardianTemplate| t.max_price_age_sec = 0,
        |t: &mut GuardianTemplate| t.debt_extra_decimals = 39,
        |t: &mut GuardianTemplate| t.debt_price_id = "zz".repeat(32),
    ] {
        let mut bad = template();
        edit(&mut bad);
        assert!(refused(|| {
            context("d.test.near", 0);
            GuardianFactory::new(bad, U128(min()), U128(max()))
        }));
    }
    assert!(refused(|| {
        context("d.test.near", 0);
        GuardianFactory::new(template(), U128(max()), U128(min()))
    }));
    if GUARDIAN_CODE.len() > 1 {
        assert!(refused(|| {
            context("d.test.near", 0);
            GuardianFactory::new(
                template(),
                U128(GuardianFactory::storage_floor() - 1),
                U128(max()),
            )
        }));
    }
    // 32 + 1 + factory id must fit the 64-character account id limit.
    assert!(refused(|| {
        testing_env!(VMContextBuilder::new()
            .current_account_id(id(&format!("{}.test.near", "f".repeat(40))))
            .build());
        GuardianFactory::new(template(), U128(min()), U128(max()))
    }));
}

#[test]
fn child_ids_are_derived_per_owner_and_nonce_under_the_factory_namespace() {
    let f = factory();
    let a = f.get_next_guardian_id(id("alice.test.near"));
    let b = f.get_next_guardian_id(id("bob.test.near"));
    assert_ne!(a, b);
    assert_eq!(a, f.get_next_guardian_id(id("alice.test.near")));
    let (label, parent) = a.as_str().split_once('.').unwrap();
    assert_eq!(parent, "factory.test.near");
    assert_eq!(label.len(), 32);
    assert!(label.bytes().all(|c| c.is_ascii_hexdigit()));
    // Owner ids that differ only by a suffix never share a label.
    assert_ne!(
        f.get_next_guardian_id(id("a.test.near")),
        f.get_next_guardian_id(id("aa.test.near"))
    );
}

#[test]
fn creation_is_one_keyless_batch_with_template_config_and_embedded_code() {
    let (_f, child) = started("alice.test.near");
    let receipts = get_created_receipts();
    let batch = receipts
        .iter()
        .find(|r| r.receiver_id == child)
        .expect("one receipt for the child");
    let mut kinds = Vec::new();
    let mut init: Option<Value> = None;
    for action in &batch.actions {
        match action {
            MockAction::CreateAccount { .. } => kinds.push("create"),
            MockAction::Transfer { deposit, .. } => {
                assert_eq!(deposit.as_yoctonear(), min());
                kinds.push("transfer");
            }
            MockAction::DeployContract { code, .. } => {
                assert_eq!(code.as_slice(), GUARDIAN_CODE);
                kinds.push("deploy");
            }
            MockAction::FunctionCallWeight {
                method_name,
                args,
                attached_deposit,
                ..
            } => {
                assert_eq!(method_name.as_slice(), b"new");
                assert_eq!(attached_deposit.as_yoctonear(), 0);
                init = serde_json::from_slice(args).ok();
                kinds.push("init");
            }
            other => panic!("no key, stake or delete action may appear: {other:?}"),
        }
    }
    assert_eq!(kinds, ["create", "transfer", "deploy", "init"]);
    let init = init.expect("init args");
    assert_eq!(init["config"]["owner_id"], "alice.test.near");
    assert_eq!(init["config"]["watcher_id"], "watcher.test.near");
    assert_eq!(init["config"]["lending_id"], "lending.test.near");
    assert_eq!(
        init["config"]["collateral_token_ids"][0],
        "collateral.test.near"
    );
    assert_eq!(init["policy"]["max_per_action"], "100");
}

#[test]
fn creation_rejects_bad_funding_gas_policy_and_duplicates_without_effects() {
    prepared();
    let mut f = factory();
    for deposit in [0, min() - 1, max() + 1] {
        assert!(
            refused(|| create(&mut f, "alice.test.near", deposit)),
            "{deposit}"
        );
    }
    context("alice.test.near", min());
    testing_env!(VMContextBuilder::new()
        .current_account_id(id("factory.test.near"))
        .predecessor_account_id(id("alice.test.near"))
        .attached_deposit(NearToken::from_yoctonear(min()))
        .prepaid_gas(Gas::from_tgas(100))
        .build());
    assert!(refused(|| f.create_guardian(policy())));
    context("alice.test.near", min());
    let mut bad = policy();
    bad.cooldown_sec = 1;
    assert!(refused(|| f.create_guardian(bad)));
    assert!(!f.is_pending(id("alice.test.near")));
    assert!(get_created_receipts().is_empty());

    create(&mut f, "alice.test.near", min());
    assert!(f.is_pending(id("alice.test.near")));
    assert!(refused(|| create(&mut f, "alice.test.near", min())));
    assert!(
        get_created_receipts().is_empty(),
        "a refused duplicate schedules nothing"
    );
    // A different owner is independent.
    create(&mut f, "bob.test.near", min());
    assert!(f.is_pending(id("bob.test.near")));
}

#[test]
fn success_publishes_the_mapping_once_and_advances_the_nonce() {
    let (mut f, child) = started("alice.test.near");
    assert_eq!(f.get_guardian(id("alice.test.near")), None);
    callback(PromiseResult::Successful(vec![]));
    let outcome = f.on_guardian_created(id("alice.test.near"), child.clone(), U128(min()));
    assert!(matches!(
        outcome,
        PromiseOrValue::Value(CreateOutcome::Created { .. })
    ));
    assert_eq!(f.get_guardian(id("alice.test.near")), Some(child.clone()));
    assert_eq!(f.get_owner(child.clone()), Some(id("alice.test.near")));
    assert!(!f.is_pending(id("alice.test.near")));
    assert_ne!(f.get_next_guardian_id(id("alice.test.near")), child);
    assert!(get_logs().iter().any(|l| l.contains("guardian_created")));
    // Replay finds nothing pending.
    callback(PromiseResult::Successful(vec![]));
    assert!(refused(|| f.on_guardian_created(
        id("alice.test.near"),
        child,
        U128(min())
    )));
}

#[test]
fn failure_publishes_no_mapping_keeps_the_id_and_refunds_the_owner() {
    let (mut f, child) = started("alice.test.near");
    let planned = f.get_next_guardian_id(id("alice.test.near"));
    callback(PromiseResult::Failed);
    let outcome = f.on_guardian_created(id("alice.test.near"), child.clone(), U128(min()));
    drop(outcome);
    assert_eq!(f.get_guardian(id("alice.test.near")), None);
    assert_eq!(f.get_owner(child), None);
    assert!(!f.is_pending(id("alice.test.near")));
    assert_eq!(f.get_next_guardian_id(id("alice.test.near")), planned);
    let refund = get_created_receipts()
        .into_iter()
        .find(|r| r.receiver_id == id("alice.test.near"))
        .expect("refund to the owner");
    assert!(refund.actions.iter().any(
        |a| matches!(a, MockAction::Transfer { deposit, .. } if deposit.as_yoctonear() == min())
    ));
    // Retrying is allowed again.
    context("alice.test.near", min());
    let _ = f.create_guardian(policy());
    assert!(f.is_pending(id("alice.test.near")));
}

#[test]
fn refund_result_decides_sent_or_claimable_and_never_duplicates() {
    let mut f = factory();
    callback(PromiseResult::Successful(vec![]));
    let sent = f.on_refund_resolved(id("alice.test.near"), U128(500));
    assert_eq!(
        sent,
        CreateOutcome::Failed {
            phase: "create_batch".into(),
            refund: RefundStatus::Sent,
            amount: U128(500)
        }
    );
    assert_eq!(f.get_unclaimed(id("alice.test.near")), U128(0));
    callback(PromiseResult::Failed);
    let claimable = f.on_refund_resolved(id("alice.test.near"), U128(500));
    assert!(matches!(
        claimable,
        CreateOutcome::Failed {
            refund: RefundStatus::Claimable,
            ..
        }
    ));
    assert_eq!(f.get_unclaimed(id("alice.test.near")), U128(500));
}

#[test]
fn claim_refund_pays_once_and_restores_on_a_failed_transfer() {
    let mut f = factory();
    callback(PromiseResult::Failed);
    let _ = f.on_refund_resolved(id("alice.test.near"), U128(500));
    // Foreign caller, missing yocto, and nothing to claim all fail.
    context("bob.test.near", 1);
    assert!(refused(|| f.claim_refund()));
    context("alice.test.near", 0);
    assert!(refused(|| f.claim_refund()));
    assert_eq!(f.get_unclaimed(id("alice.test.near")), U128(500));

    context("alice.test.near", 1);
    let _ = f.claim_refund();
    assert_eq!(f.get_unclaimed(id("alice.test.near")), U128(0));
    context("alice.test.near", 1);
    assert!(refused(|| f.claim_refund()), "no second payout");
    callback(PromiseResult::Failed);
    assert!(!f.on_claim_resolved(id("alice.test.near"), U128(500)));
    assert_eq!(f.get_unclaimed(id("alice.test.near")), U128(500));
    callback(PromiseResult::Successful(vec![]));
    assert!(f.on_claim_resolved(id("alice.test.near"), U128(500)));
}

#[test]
fn factory_exposes_no_way_to_change_code_config_or_existing_guardians() {
    // The template is immutable after init; views return what init stored.
    let f = factory();
    assert_eq!(f.get_template().lending_id, id("lending.test.near"));
    assert_eq!(f.get_limits().min_funding, U128(min()));
}
