import { assembleCard } from "@mrfund/engine";
import { afterEach, expect, it, vi } from "vitest";
import { createDemoExecution } from "../src/play/source/demoExecution";
import { createDemoPosition } from "../src/play/source/demoPosition";
import { createDemoSession } from "../src/play/source/demoSession";
import { createDemoSource } from "../src/play/source/demoSource";
import type { WalletOutcome } from "../src/play/source/types";

afterEach(() => vi.useRealTimers());
it.each<WalletOutcome>(["cancel", "failure", "partial", "success"])(
  "applies only a successful %s approval",
  async (outcome) => {
    vi.useFakeTimers();
    const session = createDemoSession();
    const position = createDemoPosition(() => session.port.getSnapshot().walletBalance);
    const execution = createDemoExecution(session, position);
    const connection = session.port.connect();
    expect(session.port.getSnapshot().connecting).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    await connection;
    expect(session.port.getSnapshot().connected).toBe(true);
    const approval = execution.port.prepareRepay("100");
    expect(approval?.amount).toBe("100.10 test USDC");
    const events = (async () => {
      for await (const _event of execution.port.execute(
        approval?.id ?? "",
        outcome,
        new AbortController().signal,
      )) {
        /* consume */
      }
    })();
    await vi.advanceTimersByTimeAsync(1100);
    await events;
    expect(position.port.getSnapshot().debt).toBe(
      outcome === "success" ? 1_700_000_000n : 1_800_000_000n,
    );
    expect(session.port.getSnapshot().walletBalance).toBe(
      outcome === "success" ? 899_900_000n : 1_000_000_000n,
    );
    const receipts = execution.port.getSnapshot().receipts;
    expect(receipts.length).toBe(outcome === "cancel" ? 0 : 1);
    if (outcome === "success") expect(receipts[0]?.after).toBe("167.64%");
  },
);
it("does not apply an approval cancelled before settlement", async () => {
  vi.useFakeTimers();
  const session = createDemoSession();
  const position = createDemoPosition(() => session.port.getSnapshot().walletBalance);
  const execution = createDemoExecution(session, position);
  const approval = execution.port.prepareRepay("100");
  const controller = new AbortController();
  const next = execution.port
    .execute(approval?.id ?? "", "success", controller.signal)
    [Symbol.asyncIterator]()
    .next();
  const rejected = expect(next).rejects.toThrow();
  controller.abort();
  await vi.advanceTimersByTimeAsync(1100);
  await rejected;
  expect(position.port.getSnapshot().debt).toBe(1_800_000_000n);
  expect(session.port.getSnapshot().walletBalance).toBe(1_000_000_000n);
});

it("binds emitted demo cards and refuses unrelated cards instead of falling back to a local draft", async () => {
  const source = createDemoSource();
  for await (const event of source.chat.send(
    { message: "Repay", amount: "250" },
    new AbortController().signal,
  )) {
    if (event.type !== "card") continue;
    const review = source.position.advice("100", event.card);
    expect(review.card?.ok && review.card.value.amount).toBe(250_000_000n);
    expect(source.execution.prepareRepay("100", event.card)?.amount).toBe("250.10 test USDC");
    const unrelated = { ...event.card, id: "foreign-card" };
    expect(source.position.advice("100", unrelated).card).toBeNull();
    expect(source.execution.prepareRepay("100", unrelated)).toBeNull();
  }
  const draft = source.position.advice("100").card;
  if (!draft?.ok) throw new Error("Expected fixture draft");
  expect(
    source.execution.prepareRepay(
      "100",
      assembleCard(draft.value, { id: "forged", reason: "", payload: [] }),
    ),
  ).toBeNull();
});
