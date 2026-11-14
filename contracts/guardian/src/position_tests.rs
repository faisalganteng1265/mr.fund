//! Task 2.1: owner position operations. Written before the implementation.
use super::*;
use near_sdk::{
    mock::MockAction,
    serde_json::{json, Value},
    PromiseOrValue, PromiseResult,
};

struct Call {
    receiver: AccountId,
    method: String,
    args: Value,
    deposit: u128,
}

fn calls() -> Vec<Call> {
    near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|receipt| {
            let receiver = receipt.receiver_id.clone();
            receipt.actions.into_iter().filter_map(move |action| {
                if let MockAction::FunctionCallWeight {
                    method_name,
                    args,
                    attached_deposit,
                    ..
                } = action
                {
                    Some(Call {
                        receiver: receiver.clone(),
                        method: String::from_utf8(method_name).unwrap(),
                        args: serde_json::from_slice(&args).unwrap_or(Value::Null),
                        deposit: attached_deposit.as_yoctonear(),
                    })
                } else {
                    None
                }
            })
        })
        .collect()
}
fn only_call(method: &str) -> Call {
    let mut found = calls().into_iter().filter(|c| c.method == method);
    let call = found.next().unwrap_or_else(|| panic!("no {method} call"));
    assert!(found.next().is_none(), "exactly one {method} call");
    call
}
fn resolved(result: PromiseResult) {
    callback_results(vec![result]);
}
fn ok(bytes: &[u8]) -> PromiseResult {
    PromiseResult::Successful(bytes.to_vec())
}
fn state_bytes(g: &Guardian) -> Vec<u8> {
    near_sdk::borsh::to_vec(g).unwrap()
}
fn locked(op_id: u64, amount: u128, operation: state::PositionOperation) -> Guardian {
    let mut g = guardian();
    g.in_flight = Some(InFlight {
        op_id,
        amount,
        fee: 0,
        started_ns: 1,
    });
    g.next_op_id = op_id + 1;
    g.pending_position = Some(operation);
    g
}
fn position_calls(g: &mut Guardian, operation: u8) {
    match operation {
        0 => {
            let _ = g.owner_register(id("lending.test.near"), U128(1));
        }
        1 => {
            let _ = g.owner_borrow(U128(1));
        }
        2 => {
            let _ = g.owner_withdraw_collateral(U128(1));
        }
        3 => {
            let _ = g.owner_repay_from_reserve(U128(1));
        }
        _ => {
            let _ = g.owner_sweep(id("debt.test.near"));
        }
    }
}

#[test]
fn every_position_method_rejects_foreign_callers_and_missing_yocto() {
    for operation in 0..5 {
        for (caller, deposit) in [
            ("watcher.test.near", 1),
            ("attacker.test.near", 1),
            ("lending.test.near", 1),
            ("owner.test.near", 0),
            ("owner.test.near", 2),
        ] {
            let mut g = guardian();
            g.reserve = 10;
            context(caller, deposit);
            let before = state_bytes(&g);
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                position_calls(&mut g, operation)
            }));
            assert!(outcome.is_err(), "op {operation} caller {caller}/{deposit}");
            assert_eq!(state_bytes(&g), before);
            assert!(calls().is_empty(), "no receipt may leave on rejection");
        }
    }
}

#[test]
fn every_position_method_is_blocked_by_the_shared_lock() {
    for operation in 0..5 {
        for pending in [
            None,
            Some(state::PositionOperation::Borrow),
            Some(state::PositionOperation::Unresolved),
        ] {
            let mut g = guardian();
            g.reserve = 10;
            g.in_flight = Some(InFlight {
                op_id: 0,
                amount: 1,
                fee: 0,
                started_ns: 1,
            });
            g.pending_position = pending;
            context("owner.test.near", 1);
            let before = state_bytes(&g);
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                position_calls(&mut g, operation)
            }));
            assert!(outcome.is_err());
            assert_eq!(state_bytes(&g), before);
        }
    }
}

#[test]
fn registration_is_limited_to_the_three_configured_targets_with_a_positive_deposit() {
    for target in [
        "lending.test.near",
        "debt.test.near",
        "collateral.test.near",
    ] {
        let mut g = guardian();
        context("owner.test.near", 1);
        let _ = g.owner_register(id(target), U128(100_000));
        let call = only_call("storage_deposit");
        assert_eq!(call.receiver, id(target));
        assert_eq!(
            call.args,
            json!({"account_id":"guardian.test.near","registration_only":true})
        );
        assert_eq!(call.deposit, 100_000);
        assert!(g.in_flight.is_some());
    }
    for (target, deposit) in [
        ("attacker.test.near", 1),
        ("oracle.test.near", 1),
        ("lending.test.near", 0),
    ] {
        let mut g = guardian();
        context("owner.test.near", 1);
        let before = state_bytes(&g);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = g.owner_register(id(target), U128(deposit));
        }))
        .is_err());
        assert_eq!(state_bytes(&g), before);
    }
}

#[test]
fn borrow_and_release_use_fixed_lending_targets_in_rhea_internal_units() {
    let mut g = guardian();
    context("owner.test.near", 1);
    let _ = g.owner_borrow(U128(5));
    let call = only_call("execute_with_pyth");
    assert_eq!(call.receiver, id("lending.test.near"));
    assert_eq!(call.deposit, 1);
    assert_eq!(
        call.args,
        json!({"actions":[
            {"Borrow":{"token_id":"debt.test.near","amount":"5000000000000"}},
            {"Withdraw":{"token_id":"debt.test.near"}}
        ]})
    );
    assert_eq!(
        g.reserve, 0,
        "borrowed tokens never enter reserve accounting"
    );

    let mut g = guardian();
    context("owner.test.near", 1);
    let _ = g.owner_withdraw_collateral(U128(7));
    let call = only_call("execute_with_pyth");
    assert_eq!(call.receiver, id("lending.test.near"));
    assert_eq!(
        call.args,
        json!({"actions":[
            {"DecreaseCollateral":{"token_id":"collateral.test.near","amount":"7"}},
            {"Withdraw":{"token_id":"collateral.test.near"}}
        ]})
    );
}

#[test]
fn borrow_rejects_zero_and_internal_unit_overflow_without_state_change() {
    for amount in [0, u128::MAX / 10u128.pow(12) + 1] {
        let mut g = guardian();
        context("owner.test.near", 1);
        let before = state_bytes(&g);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = g.owner_borrow(U128(amount));
        }))
        .is_err());
        assert_eq!(state_bytes(&g), before);
        assert!(calls().is_empty());
    }
}

#[test]
fn position_callback_unlocks_and_reports_only_the_observed_result() {
    for (result, expected, event) in [
        (ok(b""), true, "position_operation_succeeded"),
        (PromiseResult::Failed, false, "position_operation_failed"),
    ] {
        let mut g = locked(3, 0, state::PositionOperation::Borrow);
        resolved(result);
        assert_eq!(g.on_position_resolved(3), expected);
        assert!(g.in_flight.is_none() && g.pending_position.is_none());
        assert_eq!(g.reserve, 0);
        assert!(get_logs().iter().any(|l| l.contains(event)), "{event}");
    }
}

#[test]
fn position_callbacks_are_private_and_bound_to_operation_and_kind() {
    let mut g = locked(3, 0, state::PositionOperation::Borrow);
    context("attacker.test.near", 0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        g.on_position_resolved(3)
    }))
    .is_err());
    for wrong_op in [2, 4] {
        resolved(ok(b""));
        let before = state_bytes(&g);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            g.on_position_resolved(wrong_op)
        }))
        .is_err());
        assert_eq!(state_bytes(&g), before);
    }
    // A collateral-kind lock must not be settled by the generic callback.
    let mut g = locked(3, 5, state::PositionOperation::Collateral);
    resolved(ok(b""));
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        g.on_position_resolved(3)
    }))
    .is_err());
    // Replay after settlement fails.
    let mut g = locked(3, 0, state::PositionOperation::Borrow);
    resolved(ok(b""));
    g.on_position_resolved(3);
    resolved(ok(b""));
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        g.on_position_resolved(3)
    }))
    .is_err());
}

#[test]
fn collateral_funding_forwards_only_owner_collateral_to_lending() {
    let mut g = guardian();
    let outcome = incoming(
        &mut g,
        "owner.test.near",
        "collateral.test.near",
        7,
        "{\"collateral\":{}}",
    );
    assert!(matches!(outcome, PromiseOrValue::Promise(_)));
    drop(outcome); // a Promise is scheduled when dropped
    let call = only_call("ft_transfer_call");
    assert_eq!(call.receiver, id("collateral.test.near"));
    assert_eq!(call.deposit, 1);
    assert_eq!(call.args["receiver_id"], "lending.test.near");
    assert_eq!(call.args["amount"], "7");
    let msg: Value = serde_json::from_str(call.args["msg"].as_str().unwrap()).unwrap();
    assert_eq!(
        msg,
        json!({"Execute":{"actions":[{"IncreaseCollateral":{"token_id":"collateral.test.near"}}]}})
    );
    assert!(g.in_flight.is_some());
    assert_eq!(g.reserve, 0);
}

#[test]
fn collateral_funding_refunds_everything_that_is_not_an_owner_collateral_deposit() {
    let cases = [
        (
            "attacker.test.near",
            "collateral.test.near",
            7,
            "{\"collateral\":{}}",
        ),
        (
            "owner.test.near",
            "debt.test.near",
            7,
            "{\"collateral\":{}}",
        ),
        (
            "owner.test.near",
            "wrong.test.near",
            7,
            "{\"collateral\":{}}",
        ),
        (
            "owner.test.near",
            "collateral.test.near",
            0,
            "{\"collateral\":{}}",
        ),
        (
            "owner.test.near",
            "collateral.test.near",
            7,
            "{\"reserve\":{}}",
        ),
        (
            "owner.test.near",
            "collateral.test.near",
            7,
            "{\"activate\":{}}",
        ),
        (
            "owner.test.near",
            "collateral.test.near",
            7,
            "{\"collateral\":{},\"x\":1}",
        ),
        ("owner.test.near", "collateral.test.near", 7, ""),
    ];
    for (sender, token, amount, msg) in cases {
        let mut g = guardian();
        let before = state_bytes(&g);
        assert_eq!(unused(incoming(&mut g, sender, token, amount, msg)), amount);
        assert_eq!(state_bytes(&g), before);
        assert!(calls().is_empty());
    }
    let mut g = locked(0, 1, state::PositionOperation::Borrow);
    assert_eq!(
        unused(incoming(
            &mut g,
            "owner.test.near",
            "collateral.test.near",
            7,
            "{\"collateral\":{}}"
        )),
        7
    );
}

#[test]
fn collateral_resolution_returns_only_what_lending_did_not_use() {
    for (result, expected) in [
        (ok(b"\"7\""), 0),
        (ok(b"\"3\""), 4),
        (ok(b"\"0\""), 7),
        // Anything ambiguous returns the full amount: the outer NEP-141 resolver
        // can refund no more than the Guardian still holds.
        (PromiseResult::Failed, 7),
        (ok(b"bad"), 7),
        (ok(b"\"8\""), 7),
    ] {
        let mut g = locked(2, 7, state::PositionOperation::Collateral);
        resolved(result);
        assert_eq!(g.on_collateral_resolved(2, U128(7)).0, expected);
        assert!(g.in_flight.is_none() && g.pending_position.is_none());
    }
}

#[test]
fn manual_repay_debits_reserve_sends_version_message_and_charges_no_fee() {
    for (version, expected) in [
        (
            "0.11.0",
            json!({"Execute":{"actions":[{"Repay":{"token_id":"debt.test.near","max_amount":"40000000000000"}}]}}),
        ),
        ("0.16.2", json!("OnlyRepay")),
    ] {
        let mut g = guardian();
        g.config.lending_version = version.into();
        g.reserve = 100;
        context("owner.test.near", 1);
        let _ = g.owner_repay_from_reserve(U128(40));
        assert_eq!(g.reserve, 60);
        let call = only_call("ft_transfer_call");
        assert_eq!(call.receiver, id("debt.test.near"));
        assert_eq!(call.args["receiver_id"], "lending.test.near");
        assert_eq!(call.args["amount"], "40");
        let msg: Value = serde_json::from_str(call.args["msg"].as_str().unwrap()).unwrap();
        assert_eq!(msg, expected, "{version}");
        assert!(
            !calls()
                .iter()
                .any(|c| c.args["receiver_id"] == "fees.test.near"),
            "manual repay never pays an action fee"
        );
    }
}

#[test]
fn manual_repay_rejects_zero_overdraw_and_overflow_without_state_change() {
    for amount in [0, 101, u128::MAX] {
        let mut g = guardian();
        g.reserve = 100;
        context("owner.test.near", 1);
        let before = state_bytes(&g);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = g.owner_repay_from_reserve(U128(amount));
        }))
        .is_err());
        assert_eq!(state_bytes(&g), before);
    }
    // The floor binds the automatic path only: the owner may spend all of it.
    let mut g = guardian();
    g.reserve = 100;
    context("owner.test.near", 1);
    let _ = g.owner_repay_from_reserve(U128(100));
    assert_eq!(g.reserve, 0);
}

#[test]
fn manual_repay_settles_only_accepted_spend() {
    for (used, restored) in [(0u128, 40u128), (15, 25), (40, 0)] {
        let mut g = locked(5, 40, state::PositionOperation::ManualRepay);
        g.reserve = 60;
        g.spent_total = 9;
        resolved(ok(format!("\"{used}\"").as_bytes()));
        assert_eq!(g.on_manual_repay_resolved(5).0, used);
        assert_eq!(g.reserve, 60 + restored);
        assert_eq!(
            g.spent_total, 9,
            "manual spend is not automatic-policy spend"
        );
        assert!(g.in_flight.is_none() && g.pending_position.is_none());
    }
}

#[test]
fn ambiguous_manual_repay_keeps_the_lock_and_never_restores_reserve() {
    for result in [
        PromiseResult::Failed,
        ok(b"bad"),
        ok(b"\"41\""),
        ok(&[b'0'; 1025]),
    ] {
        let mut g = locked(5, 40, state::PositionOperation::ManualRepay);
        g.reserve = 60;
        resolved(result);
        let _ = g.on_manual_repay_resolved(5);
        assert_eq!(g.reserve, 60);
        assert!(g.in_flight.is_some());
        assert_eq!(
            g.pending_position,
            Some(state::PositionOperation::Unresolved)
        );
        assert!(get_logs()
            .iter()
            .any(|l| l.contains("manual_repay_unresolved")));
        // No administrative unlock: every owner position method stays blocked.
        context("owner.test.near", 1);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = g.owner_sweep(id("debt.test.near"));
        }))
        .is_err());
    }
}

fn start_sweep(g: &mut Guardian, token: &str) {
    context("owner.test.near", 1);
    let _ = g.owner_sweep(id(token));
}
fn balance_reply(balance: u128) -> PromiseResult {
    ok(format!("\"{balance}\"").as_bytes())
}

#[test]
fn sweep_reads_the_balance_first_and_holds_the_lock() {
    let mut g = guardian();
    g.reserve = 100;
    g.status = Status::Active; // the status check precedes the lock check
    start_sweep(&mut g, "debt.test.near");
    let call = only_call("ft_balance_of");
    assert_eq!(call.receiver, id("debt.test.near"));
    assert_eq!(call.args, json!({"account_id":"guardian.test.near"}));
    assert!(calls().iter().all(|c| c.method != "ft_transfer"));
    // The lock turns away the watcher and reserve deposits for the whole sweep.
    context("watcher.test.near", 0);
    assert!(matches!(
        g.request_repay(U128(1)),
        PromiseOrValue::Value(state::RequestOutcome::Rejected {
            reason: state::RejectReason::InFlight,
            ..
        })
    ));
    assert_eq!(
        unused(incoming(
            &mut g,
            "owner.test.near",
            "debt.test.near",
            5,
            "{\"reserve\":{}}"
        )),
        5
    );
}

#[test]
fn sweep_excludes_the_current_reserve_even_if_it_changed_during_the_read() {
    let mut g = guardian();
    g.reserve = 100;
    start_sweep(&mut g, "debt.test.near");
    // Race vector: reserve obligations differ when the balance reply arrives.
    g.reserve = 120;
    resolved(balance_reply(150));
    let _ = g.on_sweep_balance(0, id("debt.test.near"));
    let call = only_call("ft_transfer");
    assert_eq!(call.receiver, id("debt.test.near"));
    assert_eq!(call.deposit, 1);
    assert_eq!(call.args["receiver_id"], "owner.test.near");
    assert_eq!(
        call.args["amount"], "30",
        "only balance above the live reserve moves"
    );
    assert_eq!(g.reserve, 120);
}

#[test]
fn sweep_never_moves_committed_in_flight_amounts() {
    let mut g = guardian();
    g.reserve = 100;
    start_sweep(&mut g, "debt.test.near");
    // A reserve-debiting operation that took the lock is committed funds too.
    g.in_flight.as_mut().unwrap().amount = 40;
    resolved(balance_reply(150));
    let _ = g.on_sweep_balance(0, id("debt.test.near"));
    assert_eq!(only_call("ft_transfer").args["amount"], "10");
}

#[test]
fn sweep_of_other_tokens_moves_the_whole_balance() {
    let mut g = guardian();
    g.reserve = 100;
    start_sweep(&mut g, "collateral.test.near");
    resolved(balance_reply(150));
    let _ = g.on_sweep_balance(0, id("collateral.test.near"));
    let call = only_call("ft_transfer");
    assert_eq!(call.receiver, id("collateral.test.near"));
    assert_eq!(call.args["amount"], "150");
}

#[test]
fn sweep_with_nothing_above_the_reserve_or_a_bad_balance_sends_nothing_and_unlocks() {
    for (balance, reply) in [
        (100u128, balance_reply(100)),
        (99, balance_reply(99)),
        (0, PromiseResult::Failed),
        (0, ok(b"not-a-balance")),
        (0, ok(&[b'1'; 1025])),
    ] {
        let _ = balance;
        let mut g = guardian();
        g.reserve = 100;
        start_sweep(&mut g, "debt.test.near");
        resolved(reply);
        let outcome = g.on_sweep_balance(0, id("debt.test.near"));
        assert!(matches!(outcome, PromiseOrValue::Value(false)));
        assert!(calls().iter().all(|c| c.method != "ft_transfer"));
        assert!(g.in_flight.is_none() && g.pending_position.is_none());
        assert_eq!(g.reserve, 100);
    }
}

#[test]
fn sweep_resolution_only_unlocks_and_never_touches_reserve() {
    for (result, expected, event) in [
        (ok(b""), true, "swept"),
        (PromiseResult::Failed, false, "sweep_failed"),
    ] {
        let mut g = locked(4, 0, state::PositionOperation::SweepSend);
        g.reserve = 100;
        resolved(result);
        assert_eq!(g.on_sweep_resolved(4, U128(30)), expected);
        assert!(g.in_flight.is_none() && g.pending_position.is_none());
        assert_eq!(g.reserve, 100);
        assert!(get_logs().iter().any(|l| l.contains(event)), "{event}");
    }
}

#[test]
fn sweep_callbacks_are_private_and_phase_bound() {
    let mut g = locked(4, 0, state::PositionOperation::SweepSend);
    resolved(balance_reply(150));
    // The send-phase lock cannot be advanced as if it were the balance read.
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = g.on_sweep_balance(4, id("debt.test.near"));
    }))
    .is_err());
    let mut g = guardian();
    start_sweep(&mut g, "debt.test.near");
    context("attacker.test.near", 0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = g.on_sweep_balance(0, id("debt.test.near"));
    }))
    .is_err());
    resolved(balance_reply(150));
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = g.on_sweep_balance(9, id("debt.test.near"));
    }))
    .is_err());
}
