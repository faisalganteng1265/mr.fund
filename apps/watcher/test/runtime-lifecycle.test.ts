import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Watcher } from "../src/core/loop";
import { createWatcher } from "../src/core/loop";
import type { StartupEvidence } from "../src/core/types";
import { runWatcher } from "../src/runtime/lifecycle";
import { createRuntimeLog } from "../src/runtime/log";
import { clock, events, fakeReads, fakeRequester, GUARDIAN } from "./fixture";

afterEach(() => vi.useRealTimers());
describe("watcher lifecycle", () => {
  it("emits timed heartbeats and stops once on signal", () => {
    vi.useFakeTimers();
    const signals = new EventEmitter();
    const watcher = {
      start: vi.fn(),
      stop: vi.fn(),
      status: () => ({ observedAt: Date.now(), startedAt: 0, intervalMs: 30_000, guardians: [] }),
    } as unknown as Watcher;
    const lines: string[] = [];
    const stop = runWatcher(
      watcher,
      createRuntimeLog((line) => lines.push(line)),
      signals,
      1000,
    );
    expect(watcher.start).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(lines).toHaveLength(2);
    signals.emit("SIGTERM");
    stop();
    expect(watcher.stop).toHaveBeenCalledOnce();
    expect(lines).toHaveLength(3);
    vi.advanceTimersByTime(5000);
    expect(lines).toHaveLength(3);
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });
  it("locks safely if an unexpected scheduled poll error escapes an adapter", async () => {
    const time = clock();
    const reads = fakeReads(time.now);
    const requester = fakeRequester();
    const log = events();
    const malformed = Object.defineProperty({}, "kind", {
      get() {
        throw new Error("SENTINEL_SECRET");
      },
    }) as StartupEvidence;
    const watcher = createWatcher({
      guardians: [
        {
          target: { network: "testnet", guardianId: GUARDIAN },
          requester: requester.requester,
          startup: async () => malformed,
        },
      ],
      reads: reads.reads,
      clock: time,
      log: log.log,
    });
    await expect(watcher.tick()).resolves.toBeUndefined();
    expect(watcher.status().guardians[0]).toMatchObject({
      requests: "read_only",
      readOnlyReason: "poll_uncertain",
    });
    expect(JSON.stringify(log.list)).not.toContain("SENTINEL_SECRET");
    expect(requester.sent).toHaveLength(0);
  });
  it("does not start a request when shutdown happens during a pending read", async () => {
    const time = clock();
    const reads = fakeReads(time.now);
    const requester = fakeRequester();
    let release = () => {};
    reads.state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const watcher = createWatcher({
      guardians: [
        {
          target: { network: "testnet", guardianId: GUARDIAN },
          requester: requester.requester,
          startup: async () => ({ kind: "clear" }),
        },
      ],
      reads: reads.reads,
      clock: time,
      log: () => {},
      operatorReconciled: [GUARDIAN],
    });
    watcher.start();
    watcher.stop();
    release();
    await vi.waitFor(() => expect(reads.state.positionCalls).toBe(1));
    await Promise.resolve();
    expect(requester.sent).toHaveLength(0);
  });
});
