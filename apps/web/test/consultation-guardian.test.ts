import { afterEach, expect, it, vi } from "vitest";
import { createDemoSource } from "../src/play/source/demoSource";
import type { ConsultationSource, OwnerAction } from "../src/play/source/types";

afterEach(() => vi.useRealTimers());
async function control(source: ConsultationSource, action: OwnerAction | "activate") {
  const approval = source.guardian.prepare(action, source.guardian.getSnapshot().savedFields);
  if (typeof approval === "string") throw new Error(approval);
  const pending = (async () => {
    for await (const _event of source.execution.execute(
      approval.id,
      "success",
      new AbortController().signal,
    )) {
      /* consume */
    }
  })();
  await vi.advanceTimersByTimeAsync(1100);
  await pending;
}
it("keeps Guardian debt separate and preserves reserve on over-limit and repeated replay", async () => {
  vi.useFakeTimers();
  const source = createDemoSource();
  expect(
    Object.values(source)
      .filter((p) => typeof p === "object")
      .every((p) => p.provenance === "simulated"),
  ).toBe(true);
  await control(source, "activate");
  expect(source.guardian.getSnapshot().reserve).toBe(500_000_000n);
  expect(source.session.getSnapshot().walletBalance).toBe(499_000_000n);
  source.guardian.replay(true);
  expect(source.guardian.getSnapshot().reserve).toBe(500_000_000n);
  source.guardian.replay(false);
  source.guardian.replay(false);
  expect(source.guardian.getSnapshot().reserve).toBe(400_000_000n);
  expect(source.guardian.getSnapshot().guardianDebt).toBe(1_700_000_000n);
  expect(source.position.getSnapshot().debt).toBe(1_800_000_000n);
  expect(source.execution.getSnapshot().receipts[0]?.status).toBe("rejected");
  await control(source, "deactivate");
  await control(source, "withdraw");
  expect(source.guardian.getSnapshot().reserve).toBe(0n);
  expect(source.session.getSnapshot().walletBalance).toBe(899_000_000n);
});
it("validates policy and blocks offline and paused replays without spending", async () => {
  vi.useFakeTimers();
  const source = createDemoSource();
  const fields = source.guardian.getSnapshot().savedFields;
  expect(source.guardian.validate({ ...fields, trigger: "100" })).not.toBeNull();
  expect(source.guardian.validate({ ...fields, deposit: "1" })).not.toBeNull();
  await control(source, "activate");
  source.guardian.setWatcherOnline(false);
  expect(source.guardian.replay(false)).toBe("Watcher is offline. Replay blocked.");
  source.guardian.setWatcherOnline(true);
  await control(source, "pause");
  expect(source.guardian.replay(false)).toBe("Guardian must be active for a trigger replay.");
  expect(source.guardian.getSnapshot().reserve).toBe(500_000_000n);
  await control(source, "resume");
  await control(source, "topup");
  expect(source.guardian.getSnapshot().reserve).toBe(550_000_000n);
});
