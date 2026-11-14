import type { Card } from "@mrfund/shared";
import { comparison, draft, metrics, scenario, snapshot } from "../demo";
import { demoDelay } from "./demoDelay";
import type { DataState, PositionPort, PositionView } from "./types";

export interface DemoPosition {
  port: PositionPort;
  rememberCard(card: Card, value: string): void;
  repay(value: bigint): void;
  reset(): void;
}
export function createDemoPosition(balance: () => bigint): DemoPosition {
  let debt = 1_800_000_000n;
  let dataState: DataState = "fresh";
  const listeners = new Set<() => void>();
  const recommendations = new WeakMap<Card, string>();
  function view(): PositionView {
    const now = Date.now();
    const value = snapshot(debt, now, dataState);
    return {
      debt,
      now,
      dataState,
      snapshot: value,
      current: metrics(value, now),
      figures: { collateralUsd: "5,000.00", borrowApr: "21.00%", supplyApr: "14.01%" },
    };
  }
  let current = view();
  function publish() {
    current = view();
    for (const listener of listeners) listener();
  }
  const port: PositionPort = {
    provenance: "simulated",
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    advice(value, recommendation) {
      const input = recommendation ? recommendations.get(recommendation) : value;
      const card =
        input === undefined ? null : draft(current.snapshot, input, balance(), current.now);
      return {
        card,
        comp: comparison(
          current.snapshot,
          card?.ok ? card.value.amount : 100_000_000n,
          current.now,
        ),
        whatIf: scenario(current.snapshot, current.now),
      };
    },
    async refresh(signal) {
      signal?.throwIfAborted();
      dataState = "loading";
      publish();
      await demoDelay(650, signal);
      signal?.throwIfAborted();
      dataState = "fresh";
      publish();
    },
    selectDataState(state) {
      dataState = state;
      publish();
    },
  };
  return {
    port,
    rememberCard(card, value) {
      recommendations.set(card, value);
    },
    repay(value: bigint) {
      debt -= value;
      publish();
    },
    reset() {
      debt = 1_800_000_000n;
      dataState = "fresh";
      publish();
    },
  };
}
