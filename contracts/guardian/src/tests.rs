use super::*;
use near_sdk::{
    json_types::U128,
    serde_json,
    test_utils::{get_logs, VMContextBuilder},
    testing_env, NearToken,
};

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn context(caller: &str, deposit: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(id("guardian.test.near"))
        .predecessor_account_id(id(caller))
        .signer_account_id(id(caller))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .build());
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
fn guardian() -> Guardian {
    context("factory.test.near", 0);
    Guardian::new(
        GuardianConfig {
            owner_id: id("owner.test.near"),
            watcher_id: id("watcher.test.near"),
            lending_id: id("lending.test.near"),
            oracle_id: id("oracle.test.near"),
            debt_token_id: id("debt.test.near"),
            collateral_token_ids: vec![id("collateral.test.near")],
            fee_recipient_id: id("fees.test.near"),
            activation_fee: U128(5),
            lending_version: "0.11.0".into(),
            debt_extra_decimals: 12,
            collateral_extra_decimals: 0,
            collateral_price_id: "11".repeat(32),
            debt_price_id: "22".repeat(32),
            max_price_age_sec: 60,
        },
        policy(),
    )
}

fn incoming(
    g: &mut Guardian,
    sender: &str,
    token: &str,
    amount: u128,
    msg: &str,
) -> near_sdk::PromiseOrValue<U128> {
    context(token, 0);
    g.ft_on_transfer(id(sender), U128(amount), msg.into())
}
fn unused(value: near_sdk::PromiseOrValue<U128>) -> u128 {
    match value {
        near_sdk::PromiseOrValue::Value(n) => n.0,
        _ => panic!("expected immediate refund"),
    }
}
fn promise_context(result: near_sdk::PromiseResult) {
    let ctx = VMContextBuilder::new()
        .current_account_id(id("guardian.test.near"))
        .predecessor_account_id(id("guardian.test.near"))
        .build();
    testing_env!(
        ctx,
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}
#[test]
fn activation_refunds_below_minimum_wrong_token_and_wrong_sender() {
    let mut g = guardian();
    assert_eq!(
        unused(incoming(
            &mut g,
            "owner.test.near",
            "debt.test.near",
            125,
            "{\"activate\":{}}"
        )),
        125
    ); // minimum = fee5 + floor20 + max100 + actionFee1
    assert_eq!(
        unused(incoming(
            &mut g,
            "attacker.test.near",
            "debt.test.near",
            126,
            "{\"activate\":{}}"
        )),
        126
    );
    assert_eq!(
        unused(incoming(
            &mut g,
            "owner.test.near",
            "wrong.test.near",
            126,
            "{\"activate\":{}}"
        )),
        126
    );
    assert_eq!(g.reserve, 0);
    assert_eq!(g.status, Status::Created);
}
#[test]
fn activation_books_reserve_only_after_fee_settles_and_cannot_repeat() {
    let mut g = guardian();
    assert!(matches!(
        incoming(
            &mut g,
            "owner.test.near",
            "debt.test.near",
            126,
            "{\"activate\":{}}"
        ),
        near_sdk::PromiseOrValue::Promise(_)
    ));
    assert_eq!(g.reserve, 0);
    assert_eq!(g.status, Status::Created);
    promise_context(near_sdk::PromiseResult::Successful(Vec::new()));
    assert_eq!(g.on_activation_resolved(0).0, 0);
    assert_eq!(g.reserve, 121);
    assert_eq!(g.status, Status::Active);
    assert_eq!(
        unused(incoming(
            &mut g,
            "owner.test.near",
            "debt.test.near",
            126,
            "{\"activate\":{}}"
        )),
        126
    );
}
#[test]
fn failed_activation_fee_returns_full_amount_without_activation() {
    let mut g = guardian();
    let _ = incoming(
        &mut g,
        "owner.test.near",
        "debt.test.near",
        126,
        "{\"activate\":{}}",
    );
    promise_context(near_sdk::PromiseResult::Failed);
    assert_eq!(g.on_activation_resolved(0).0, 126);
    assert_eq!(g.reserve, 0);
    assert_eq!(g.status, Status::Created);
    assert!(g.in_flight.is_none());
}
#[test]
fn deactivated_owner_can_withdraw_and_failure_restores_reserve() {
    let mut g = guardian();
    g.status = Status::Deactivated;
    assert_eq!(
        unused(incoming(
            &mut g,
            "owner.test.near",
            "debt.test.near",
            100,
            "{\"reserve\":{}}"
        )),
        0
    );
    context("owner.test.near", 1);
    let _ = g.owner_withdraw_reserve(U128(100));
    assert_eq!(g.reserve, 0);
    assert_eq!(
        unused(incoming(
            &mut g,
            "owner.test.near",
            "debt.test.near",
            1,
            "{\"reserve\":{}}"
        )),
        1
    );
    promise_context(near_sdk::PromiseResult::Failed);
    assert!(!g.on_withdraw_resolved(0));
    assert_eq!(g.reserve, 100);
    context("owner.test.near", 1);
    let _ = g.owner_withdraw_reserve(U128(100));
    promise_context(near_sdk::PromiseResult::Successful(Vec::new()));
    assert!(g.on_withdraw_resolved(1));
    assert_eq!(g.reserve, 0);
}
#[test]
#[should_panic(expected = "Operation in flight")]
fn reserve_withdrawal_is_blocked_while_locked() {
    let mut g = guardian();
    g.reserve = 100;
    g.in_flight = Some(InFlight {
        op_id: 0,
        amount: 1,
        fee: 0,
        started_ns: 0,
    });
    context("owner.test.near", 1);
    let _ = g.owner_withdraw_reserve(U128(1));
}
#[test]
fn initialization_exposes_created_policy_and_zero_reserve() {
    let g = guardian();
    assert_eq!(g.get_status().status, Status::Created);
    assert_eq!(g.get_status().owner_id, id("owner.test.near"));
    assert_eq!(g.get_policy().max_per_action, U128(100));
    assert_eq!(g.get_reserve().reserve, U128(0));
    assert_eq!(g.get_reserve().spendable, U128(0));
    assert!(g.get_history(0, 50).is_empty());
}
#[test]
fn policy_accepts_exact_minimums_and_rejects_each_invalid_boundary() {
    let mut p = policy();
    p.trigger_hf_bps = 10500;
    p.lifetime_cap = p.max_per_action;
    assert!(p.validate().is_ok());
    for field in 0..5 {
        let mut p = policy();
        match field {
            0 => p.trigger_hf_bps = 10499,
            1 => p.lifetime_cap = U128(99),
            2 => p.cooldown_sec = 299,
            3 => p.max_per_action = U128(0),
            _ => p.target_hf_bps = Some(12000),
        }
        assert!(p.validate().is_err());
    }
}
#[test]
#[should_panic(expected = "Owner only")]
fn watcher_cannot_change_policy() {
    let mut g = guardian();
    context("watcher.test.near", 1);
    g.set_policy(policy());
}
#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn function_call_key_cannot_pause() {
    let mut g = guardian();
    context("owner.test.near", 0);
    g.pause();
}
#[test]
fn owner_transitions_are_terminal_and_emit_nep297() {
    let mut g = guardian();
    g.status = Status::Active;
    context("owner.test.near", 1);
    g.pause();
    assert_eq!(g.get_status().status, Status::Paused);
    g.resume();
    assert_eq!(g.get_status().status, Status::Active);
    g.rotate_watcher(id("new-watcher.test.near"));
    assert_eq!(g.get_status().watcher_id, id("new-watcher.test.near"));
    g.deactivate();
    assert_eq!(g.get_status().status, Status::Deactivated);
    let events: Vec<serde_json::Value> = get_logs()
        .iter()
        .map(|s| serde_json::from_str(s.strip_prefix("EVENT_JSON:").unwrap()).unwrap())
        .collect();
    assert_eq!(events[0]["standard"], "mrfund_guardian");
    assert_eq!(events[0]["version"], "1.0.0");
    assert_eq!(events[0]["event"], "paused");
    assert_eq!(events[3]["event"], "deactivated");
}
#[test]
#[should_panic(expected = "Invalid status transition")]
fn deactivated_cannot_resume() {
    let mut g = guardian();
    g.status = Status::Deactivated;
    context("owner.test.near", 1);
    g.resume();
}
#[test]
#[should_panic(expected = "Operation in flight")]
fn policy_change_is_blocked_during_pending_operation() {
    let mut g = guardian();
    g.in_flight = Some(InFlight {
        op_id: 0,
        amount: 7,
        fee: 1,
        started_ns: 0,
    });
    context("owner.test.near", 1);
    g.set_policy(policy());
}
#[test]
fn owner_controls_make_no_external_calls() {
    let mut g = guardian();
    context("owner.test.near", 1);
    let mut p = policy();
    p.max_per_action = U128(50);
    g.set_policy(p);
    assert_eq!(g.get_policy().max_per_action, U128(50));
    assert!(near_sdk::test_utils::get_created_receipts().is_empty());
}

#[test]
fn all_owner_methods_reject_foreign_predecessors_without_state_change() {
    for operation in 0..5 {
        let mut g = guardian();
        g.status = if operation == 3 {
            Status::Paused
        } else {
            Status::Active
        };
        context("attacker.test.near", 1);
        let before = near_sdk::borsh::to_vec(&g).unwrap();
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match operation {
            0 => g.set_policy(policy()),
            1 => g.rotate_watcher(id("attacker.test.near")),
            2 => g.pause(),
            3 => g.resume(),
            _ => g.deactivate(),
        }));
        assert!(outcome.is_err());
        assert_eq!(near_sdk::borsh::to_vec(&g).unwrap(), before);
    }
}

#[test]
fn lowering_cap_below_cumulative_spend_is_rejected_without_mutation() {
    let mut g = guardian();
    g.spent_total = 500;
    context("owner.test.near", 1);
    let mut proposed = policy();
    proposed.lifetime_cap = U128(499);
    let before = near_sdk::borsh::to_vec(&g).unwrap();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.set_policy(proposed)));
    assert!(result.is_err());
    assert_eq!(near_sdk::borsh::to_vec(&g).unwrap(), before);
    let mut exact = policy();
    exact.lifetime_cap = U128(500);
    g.set_policy(exact);
    assert_eq!(g.get_reserve().lifetime_remaining, U128(0));
}

#[test]
fn repay_policy_rejections_record_history_without_spending() {
    for (case, expected) in [
        (0, "not_active"),
        (1, "in_flight"),
        (2, "cooldown"),
        (3, "zero_amount"),
        (4, "above_max_per_action"),
        (5, "above_lifetime_cap"),
        (6, "below_reserve_floor"),
    ] {
        let mut g = guardian();
        g.status = Status::Active;
        g.reserve = 1000;
        let mut amount = 100;
        match case {
            0 => g.status = Status::Paused,
            1 => {
                g.in_flight = Some(InFlight {
                    op_id: 99,
                    amount: 1,
                    fee: 0,
                    started_ns: 0,
                })
            }
            2 => g.last_action_started_ns = 1,
            3 => amount = 0,
            4 => amount = 101,
            5 => g.spent_total = 900,
            _ => g.reserve = 120,
        }
        context("watcher.test.near", 0);
        let before = (g.reserve, g.spent_total);
        let _ = g.request_repay(U128(amount));
        assert_eq!((g.reserve, g.spent_total), before);
        assert_eq!(
            serde_json::to_value(g.get_history(0, 50)[0].reason.clone()).unwrap(),
            expected
        );
    }
}

#[test]
fn repay_rejects_foreign_callers_and_attached_deposits_without_mutation() {
    for (caller, deposit) in [
        ("attacker.test.near", 0),
        ("owner.test.near", 1),
        ("watcher.test.near", 1),
    ] {
        let mut g = guardian();
        g.status = Status::Active;
        g.reserve = 1000;
        context(caller, deposit);
        let before = near_sdk::borsh::to_vec(&g).unwrap();
        assert!(std::panic::catch_unwind(
            std::panic::AssertUnwindSafe(|| g.request_repay(U128(1)))
        )
        .is_err());
        assert_eq!(near_sdk::borsh::to_vec(&g).unwrap(), before);
    }
}

fn callback_results(results: Vec<near_sdk::PromiseResult>) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(id("guardian.test.near"))
            .predecessor_account_id(id("guardian.test.near"))
            .block_timestamp(1_000_000_000_000)
            .prepaid_gas(near_sdk::Gas::from_tgas(1000))
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}
fn ready_read() -> Guardian {
    let mut g = guardian();
    g.status = Status::Active;
    g.reserve = 121;
    g.in_flight = Some(InFlight {
        op_id: 0,
        amount: 100,
        fee: 1,
        started_ns: 1,
    });
    g.next_op_id = 1;
    g.repay_phase = Some(state::RepayPhase::Reading);
    g
}
fn trigger_responses() -> Vec<serde_json::Value> {
    use serde_json::json;
    vec![
        json!({"account_id":"guardian.test.near","collateral":[{"token_id":"collateral.test.near","balance":"100000000"}],"borrowed":[{"token_id":"debt.test.near","balance":"1000000000000000000000"}],"supplied":[]}),
        json!([{"token_id":"collateral.test.near","config":{"volatility_ratio":6000,"extra_decimals":0}},{"token_id":"debt.test.near","config":{"volatility_ratio":9500,"extra_decimals":12}}]),
        json!({"decimals":6,"fraction_digits":4,"extra_call":null,"default_price":null,"price_identifier":"11".repeat(32)}),
        json!({"decimals":6,"fraction_digits":4,"extra_call":null,"default_price":null,"price_identifier":"22".repeat(32)}),
        json!({"price":"500000000","expo":-8,"publish_time":1000}),
        json!({"price":"100000000","expo":-8,"publish_time":1000}),
        json!({"pyth_oracle_account_id":"oracle.test.near","pyth_price_valid_duration_sec":60,"enable_pyth_oracle":true}),
        json!("0.11.0"),
    ]
}
fn read_context(values: Vec<serde_json::Value>) {
    callback_results(
        values
            .into_iter()
            .map(|v| near_sdk::PromiseResult::Successful(serde_json::to_vec(&v).unwrap()))
            .collect(),
    );
}

#[test]
fn trigger_dispatch_reserves_amount_and_fee_at_exact_floor_and_cap() {
    let mut g = ready_read();
    g.policy.lifetime_cap = U128(101);
    read_context(trigger_responses());
    let _ = g.on_trigger_checked(0);
    assert_eq!(g.reserve, 20);
    assert_eq!(g.spent_total, 0);
    assert_eq!(g.repay_phase, Some(state::RepayPhase::Repaying));
    assert!(near_sdk::test_utils::get_created_receipts()
        .iter()
        .any(|r| r.receiver_id == id("debt.test.near")));
}
#[test]
fn trigger_rejects_all_untrusted_read_boundaries_without_token_dispatch() {
    use serde_json::json;
    for case in 0..12 {
        let mut g = ready_read();
        let mut v = trigger_responses();
        let expected = match case {
            0 => {
                v[4] = json!(null);
                state::RejectReason::StalePrice
            }
            1 => {
                v[4]["publish_time"] = json!(939);
                state::RejectReason::StalePrice
            }
            2 => {
                v[4]["publish_time"] = json!(1001);
                state::RejectReason::StalePrice
            }
            3 => {
                v[7] = json!("unknown");
                state::RejectReason::InvalidConfig
            }
            4 => {
                v[1][1]["config"]["extra_decimals"] = json!(0);
                state::RejectReason::InvalidConfig
            }
            5 => {
                v[6]["pyth_oracle_account_id"] = json!("foreign.test.near");
                state::RejectReason::InvalidConfig
            }
            6 => {
                v[2]["price_identifier"] = json!("ff".repeat(32));
                state::RejectReason::InvalidConfig
            }
            7 => {
                v[0]["borrowed"][0]["token_id"] = json!("other.test.near");
                state::RejectReason::UnsupportedPositionShape
            }
            8 => {
                v[2]["extra_call"] = json!("derivative");
                state::RejectReason::UnsupportedPositionShape
            }
            9 => {
                g.policy.trigger_hf_bps = 57000;
                v[0]["borrowed"][0]["balance"] = json!("10000000000000000000");
                state::RejectReason::TriggerNotMet
            }
            10 => {
                v[4]["price"] = json!("broken");
                state::RejectReason::BadResponse
            }
            _ => {
                v.pop();
                state::RejectReason::BadResponse
            }
        };
        read_context(v);
        let result = g.on_trigger_checked(0);
        assert!(
            matches!(result,near_sdk::PromiseOrValue::Value(state::RequestOutcome::Rejected{reason,..}) if reason==expected),
            "case {case}"
        );
        assert_eq!(g.reserve, 121);
        assert!(g.in_flight.is_none());
        assert!(near_sdk::test_utils::get_created_receipts().is_empty());
    }
}
#[test]
fn pause_or_deactivate_during_reads_prevents_dispatch() {
    for status in [Status::Paused, Status::Deactivated] {
        let mut g = ready_read();
        g.status = status;
        read_context(trigger_responses());
        let _ = g.on_trigger_checked(0);
        assert_eq!(g.reserve, 121);
        assert!(g.in_flight.is_none());
        assert!(near_sdk::test_utils::get_created_receipts().is_empty());
    }
}
fn repaying() -> Guardian {
    let mut g = ready_read();
    g.reserve = 20;
    g.repay_phase = Some(state::RepayPhase::Repaying);
    g
}
#[test]
fn partial_full_and_zero_refund_settle_only_accepted_spend_and_fee() {
    for used in [0, 40, 100] {
        let mut g = repaying();
        callback_results(vec![near_sdk::PromiseResult::Successful(
            format!("\"{used}\"").into_bytes(),
        )]);
        let _ = g.on_repay_resolved(0);
        if used > 0 {
            assert!(g.in_flight.is_some());
            callback_results(vec![near_sdk::PromiseResult::Successful(vec![])]);
            let _ = g.on_repay_fee_resolved(0);
        }
        assert_eq!(g.reserve, 121 - used - u128::from(used > 0));
        assert_eq!(g.spent_total, used + u128::from(used > 0));
        assert!(g.in_flight.is_none());
        assert_eq!(g.get_history(0, 50)[0].used, U128(used));
    }
}
#[test]
fn failed_fee_restores_only_fee_and_keeps_accepted_spend() {
    let mut g = repaying();
    callback_results(vec![near_sdk::PromiseResult::Successful(
        b"\"40\"".to_vec(),
    )]);
    let _ = g.on_repay_resolved(0);
    callback_results(vec![near_sdk::PromiseResult::Failed]);
    let _ = g.on_repay_fee_resolved(0);
    assert_eq!((g.reserve, g.spent_total), (81, 40));
    assert_eq!(g.get_history(0, 50)[0].fee, U128(0));
}
#[test]
fn ambiguous_resolver_never_restores_reserve_or_unlocks() {
    for result in [
        near_sdk::PromiseResult::Failed,
        near_sdk::PromiseResult::Successful(b"bad".to_vec()),
        near_sdk::PromiseResult::Successful(b"\"101\"".to_vec()),
        near_sdk::PromiseResult::Successful(vec![b'0'; 1025]),
    ] {
        let mut g = repaying();
        callback_results(vec![result]);
        let _ = g.on_repay_resolved(0);
        assert_eq!((g.reserve, g.spent_total), (20, 0));
        assert_eq!(g.repay_phase, Some(state::RepayPhase::Unresolved));
        assert!(g.in_flight.is_some());
        context("owner.test.near", 1);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || g.owner_withdraw_reserve(U128(1))
        ))
        .is_err());
    }
}
#[test]
fn callbacks_reject_replay_wrong_op_wrong_phase_and_foreign_predecessor() {
    let mut g = repaying();
    for (caller, op) in [("guardian.test.near", 1), ("attacker.test.near", 0)] {
        context(caller, 0);
        let before = near_sdk::borsh::to_vec(&g).unwrap();
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.on_repay_resolved(op)))
                .is_err()
        );
        assert_eq!(near_sdk::borsh::to_vec(&g).unwrap(), before);
    }
    callback_results(vec![near_sdk::PromiseResult::Successful(b"\"0\"".to_vec())]);
    let _ = g.on_repay_resolved(0);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.on_repay_resolved(0))).is_err()
    );
}
#[test]
fn overflow_and_last_fifty_rejections_never_mutate_money() {
    let mut g = guardian();
    g.status = Status::Active;
    g.reserve = u128::MAX;
    g.policy.max_per_action = U128(u128::MAX);
    g.policy.lifetime_cap = U128(u128::MAX);
    context("owner.test.near", 0);
    for _ in 0..60 {
        let _ = g.request_repay(U128(u128::MAX));
    }
    assert_eq!(g.reserve, u128::MAX);
    assert_eq!(g.spent_total, 0);
    assert_eq!(g.get_history(0, 100).len(), 50);
    assert_eq!(g.get_history(0, 1)[0].op_id.0, 10);
    g.next_op_id = u64::MAX;
    let before = near_sdk::borsh::to_vec(&g).unwrap();
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.request_repay(U128(1))))
            .is_err()
    );
    assert_eq!(near_sdk::borsh::to_vec(&g).unwrap(), before);
}

#[test]
fn reading_phase_serializes_requests_deposits_withdrawals_and_policy_changes() {
    let mut g = guardian();
    g.status = Status::Active;
    g.reserve = 121;
    testing_env!(VMContextBuilder::new()
        .current_account_id(id("guardian.test.near"))
        .predecessor_account_id(id("watcher.test.near"))
        .prepaid_gas(near_sdk::Gas::from_tgas(1000))
        .block_timestamp(1_000_000_000_000)
        .build());
    let _ = g.request_repay(U128(100));
    assert_eq!(g.reserve, 121);
    assert_eq!(g.repay_phase, Some(state::RepayPhase::Reading));
    let _ = g.request_repay(U128(1));
    assert_eq!(g.in_flight.as_ref().unwrap().op_id, 0);
    assert_eq!(
        unused(incoming(
            &mut g,
            "owner.test.near",
            "debt.test.near",
            100,
            "{\"reserve\":{}}"
        )),
        100
    );
    context("owner.test.near", 1);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || g.owner_withdraw_reserve(U128(1))
    ))
    .is_err());
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.set_policy(policy()))).is_err()
    );
}

#[test]
fn exact_cooldown_and_internal_conversion_overflow_are_checked() {
    let mut g = ready_read();
    g.last_action_started_ns = 700_000_000_000;
    read_context(trigger_responses());
    let _ = g.on_trigger_checked(0);
    assert_eq!(g.repay_phase, Some(state::RepayPhase::Repaying));
    let mut g = ready_read();
    g.last_action_started_ns = 700_000_000_001;
    read_context(trigger_responses());
    assert!(matches!(
        g.on_trigger_checked(0),
        near_sdk::PromiseOrValue::Value(state::RequestOutcome::Rejected {
            reason: state::RejectReason::Cooldown,
            ..
        })
    ));
    assert_eq!(g.reserve, 121);
    let mut g = ready_read();
    g.policy.max_per_action = U128(u128::MAX);
    g.policy.lifetime_cap = U128(u128::MAX);
    g.policy.action_fee = U128(0);
    g.policy.reserve_floor = U128(0);
    g.reserve = u128::MAX;
    g.in_flight.as_mut().unwrap().amount = u128::MAX;
    g.in_flight.as_mut().unwrap().fee = 0;
    read_context(trigger_responses());
    let r = g.on_trigger_checked(0);
    assert!(matches!(
        r,
        near_sdk::PromiseOrValue::Value(state::RequestOutcome::Rejected {
            reason: state::RejectReason::ArithmeticOverflow,
            ..
        })
    ));
    assert_eq!(g.reserve, u128::MAX);
    assert!(g.in_flight.is_none());
}

#[test]
fn terminal_history_preserves_start_time_after_rejection_flood() {
    let mut g = repaying();
    g.in_flight.as_mut().unwrap().started_ns = 42;
    context("watcher.test.near", 0);
    for _ in 0..51 {
        let _ = g.request_repay(U128(1));
    }
    callback_results(vec![near_sdk::PromiseResult::Successful(b"\"0\"".to_vec())]);
    let _ = g.on_repay_resolved(0);
    let last = g.get_history(49, 1);
    assert_eq!(last[0].op_id.0, 0);
    assert_eq!(last[0].at_ns.0, 42);
}

#[path = "position_tests.rs"]
mod position_tests;
