import { demoDelay } from "./demoDelay";
import type { SessionPort, SessionView } from "./types";

export interface DemoSession {
  port: SessionPort;
  changeBalance(delta: bigint): void;
  resetBalance(): void;
}
export function createDemoSession(): DemoSession {
  let state: SessionView = { connected: false, connecting: false, walletBalance: 1_000_000_000n };
  const listeners = new Set<() => void>();
  function update(next: Partial<SessionView>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }
  return {
    port: {
      provenance: "simulated",
      getSnapshot: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      async connect(signal) {
        if (state.connecting) return;
        signal?.throwIfAborted();
        update({ connecting: true });
        try {
          await demoDelay(700, signal);
          signal?.throwIfAborted();
          update({ connected: true });
        } finally {
          update({ connecting: false });
        }
      },
      disconnect() {
        update({ connected: false });
      },
    },
    changeBalance(delta) {
      update({ walletBalance: state.walletBalance + delta });
    },
    resetBalance() {
      update({ walletBalance: 1_000_000_000n });
    },
  };
}
