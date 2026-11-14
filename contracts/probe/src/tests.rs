use super::*;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn context(caller: &str, deposit: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(id("probe.test.near"))
        .predecessor_account_id(id(caller))
        .signer_account_id(id(caller))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(10))
        .prepaid_gas(Gas::from_tgas(300))
        .build());
}
fn probe() -> Probe {
    context("owner.test.near", 0);
    Probe::new(
        id("owner.test.near"),
        id("lending.test.near"),
        id("collateral.test.near"),
        id("debt.test.near"),
        12,
        0,
    )
}

#[test]
#[should_panic(expected = "Owner only")]
fn non_owner_cannot_repay() {
    let mut p = probe();
    context("attacker.test.near", 1);
    let _ = p.probe_repay(U128(1));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn function_call_key_cannot_use_owner_methods() {
    let mut p = probe();
    context("owner.test.near", 0);
    let _ = p.probe_repay(U128(1));
}

#[test]
fn receiver_rejects_foreign_senders_and_tokens() {
    let mut p = probe();
    context("debt.test.near", 0);
    assert_eq!(
        p.ft_on_transfer(id("attacker.test.near"), U128(100), String::new())
            .0,
        100
    );
    context("unknown.test.near", 0);
    assert_eq!(
        p.ft_on_transfer(id("owner.test.near"), U128(100), String::new())
            .0,
        100
    );
    context("debt.test.near", 0);
    assert_eq!(
        p.ft_on_transfer(id("owner.test.near"), U128(100), String::new())
            .0,
        0
    );
}

#[test]
fn borrow_converts_atomic_to_rhea_internal_units() {
    let mut p = probe();
    context("owner.test.near", 1);
    let _ = p.probe_borrow(U128(7));
    let receipts = get_created_receipts();
    let mut found = false;
    for receipt in receipts {
        for action in receipt.actions {
            if let near_sdk::mock::MockAction::FunctionCallWeight {
                method_name,
                args,
                attached_deposit,
                ..
            } = action
            {
                if method_name == b"execute_with_pyth" {
                    let args: serde_json::Value = serde_json::from_slice(&args).unwrap();
                    assert_eq!(args["actions"][0]["Borrow"]["amount"], "7000000000000");
                    assert_eq!(args["actions"][1]["Withdraw"]["amount"], "7000000000000");
                    assert_eq!(attached_deposit, NearToken::from_yoctonear(1));
                    found = true;
                }
            }
        }
    }
    assert!(found);
}

#[test]
#[should_panic(expected = "Unsupported registration target")]
fn registration_cannot_send_funds_to_arbitrary_accounts() {
    let mut p = probe();
    context("owner.test.near", 1);
    let _ = p.probe_register(id("attacker.test.near"), U128(1));
}

#[test]
#[should_panic(expected = "Operation in flight")]
fn overlapping_operations_are_rejected() {
    let mut p = probe();
    context("owner.test.near", 1);
    let _ = p.probe_repay(U128(1));
    let _ = p.probe_repay(U128(1));
}

#[test]
fn failed_callback_is_recorded_and_unlocks() {
    let mut p = probe();
    context("owner.test.near", 1);
    let _ = p.probe_repay(U128(7));
    let ctx = VMContextBuilder::new()
        .current_account_id(id("probe.test.near"))
        .predecessor_account_id(id("probe.test.near"))
        .build();
    testing_env!(
        ctx,
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    let result = p.on_result(0, "repay".into());
    assert!(!result.receipt_succeeded);
    assert_eq!(result.used, None);
    assert_eq!(p.in_flight, None);
}

#[test]
fn token_callback_reports_used_amount_not_requested_amount() {
    let mut p = probe();
    context("owner.test.near", 1);
    let _ = p.probe_repay(U128(7));
    let ctx = VMContextBuilder::new()
        .current_account_id(id("probe.test.near"))
        .predecessor_account_id(id("probe.test.near"))
        .build();
    testing_env!(
        ctx,
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(b"\"5\"".to_vec())]
    );
    let result = p.on_result(0, "repay".into());
    assert!(result.receipt_succeeded);
    assert_eq!(result.used, Some(U128(5)));
}

#[test]
fn legacy_repay_bounds_rhea_action_in_internal_units() {
    let mut p = probe();
    context("owner.test.near", 1);
    let _ = p.probe_repay_via_execute(U128(7));
    let mut found = false;
    for receipt in get_created_receipts() {
        for action in receipt.actions {
            if let near_sdk::mock::MockAction::FunctionCallWeight {
                method_name, args, ..
            } = action
            {
                if method_name == b"ft_transfer_call" {
                    let args: serde_json::Value = serde_json::from_slice(&args).unwrap();
                    assert_eq!(args["amount"], "7");
                    let msg: serde_json::Value =
                        serde_json::from_str(args["msg"].as_str().unwrap()).unwrap();
                    assert_eq!(
                        msg["Execute"]["actions"][0]["Repay"]["max_amount"],
                        "7000000000000"
                    );
                    assert_eq!(
                        msg["Execute"]["actions"][0]["Repay"]["token_id"],
                        "debt.test.near"
                    );
                    found = true;
                }
            }
        }
    }
    assert!(found);
}

#[test]
#[should_panic(expected = "Internal amount overflow")]
fn internal_unit_overflow_cannot_start_a_borrow() {
    let mut p = probe();
    context("owner.test.near", 1);
    let _ = p.probe_borrow(U128(u128::MAX));
}

#[test]
fn malformed_token_result_is_not_reported_as_success() {
    let mut p = probe();
    context("owner.test.near", 1);
    let _ = p.probe_repay(U128(7));
    let ctx = VMContextBuilder::new()
        .current_account_id(id("probe.test.near"))
        .predecessor_account_id(id("probe.test.near"))
        .build();
    testing_env!(
        ctx,
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(b"null".to_vec())]
    );
    let result = p.on_result(0, "repay".into());
    assert!(!result.receipt_succeeded);
    assert_eq!(result.used, None);
    assert_eq!(p.in_flight, None);
}

#[test]
fn composed_probe_reserves_continuation_gas_instead_of_read_only_callback() {
    let mut p = probe();
    context("owner.test.near", 1);
    testing_env!(VMContextBuilder::new()
        .current_account_id(id("probe.test.near"))
        .predecessor_account_id(id("owner.test.near"))
        .attached_deposit(NearToken::from_yoctonear(1))
        .prepaid_gas(Gas::from_tgas(1000))
        .build());
    // Structural receipt assertion only. The sandbox test separately enforces 300 Tgas.
    let _ = p.probe_compose_repay(
        trigger::TriggerConfig {
            oracle_id: id("oracle.test.near"),
            collateral_price_id: "11".repeat(32),
            debt_price_id: "22".repeat(32),
            max_price_age_sec: 60,
            threshold_bps: 12000,
            legacy_oracle: true,
        },
        U128(7),
        U128(1),
        id("owner.test.near"),
        "0.11.0".into(),
        None,
    );
    let mut found = false;
    for r in get_created_receipts() {
        for a in r.actions {
            if let near_sdk::mock::MockAction::FunctionCallWeight {
                method_name,
                prepaid_gas,
                ..
            } = a
            {
                if method_name == b"on_trigger_checked" {
                    assert_eq!(prepaid_gas, Gas::from_tgas(160));
                    found = true;
                }
            }
        }
    }
    assert!(found);
}
