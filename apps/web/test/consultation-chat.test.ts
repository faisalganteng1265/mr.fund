import { expect, it } from "vitest";
import { createDemoChat } from "../src/play/source/demoChat";
import { createDemoPosition } from "../src/play/source/demoPosition";
import type { ChatEvent, GuardianView } from "../src/play/source/types";

const guardian: GuardianView = {
  guardian: "inactive",
  reserve: 0n,
  guardianSpent: 0n,
  guardianDebt: 1_800_000_000n,
  savedFields: {
    max: "100",
    cap: "400",
    floor: "100",
    deposit: "500",
    trigger: "120",
    target: "150",
    cooldown: "5",
  },
  watcherOnline: true,
  spendable: 0n,
  remaining: 400_000_000n,
};
function chat() {
  const position = createDemoPosition(() => 1_000_000_000n);
  return createDemoChat((value) => ({
    position: position.port.getSnapshot(),
    advice: position.port.advice(value),
    guardian,
    receipts: [],
  }));
}
it("streams the existing deterministic recommendation with protocol-shaped events", async () => {
  const events: ChatEvent[] = [];
  for await (const event of chat().send(
    { message: "Should I repay or earn yield?", amount: "100" },
    new AbortController().signal,
  ))
    events.push(event);
  expect(events.map((e) => e.type)).toEqual(["progress", "text", "card", "done"]);
  const text = events.find((e) => e.type === "text");
  expect(text?.type === "text" && text.text).toContain(
    "Repaying 100.00 USDC avoids an estimated 21.00 USDC",
  );
  const card = events.find((e) => e.type === "card");
  expect(card?.type === "card" && card.card.payload).toEqual([]);
});
it("emits no event after cancellation, including mid-stream", async () => {
  const controller = new AbortController();
  const stream = chat()
    .send({ message: "What if NEAR drops 20%?", amount: "100" }, controller.signal)
    [Symbol.asyncIterator]();
  expect((await stream.next()).value?.type).toBe("progress");
  controller.abort();
  await expect(stream.next()).rejects.toThrow();
});
it("rejects an already-aborted turn without emitting stale text", async () => {
  const controller = new AbortController();
  controller.abort();
  const stream = chat()
    .send({ message: "Explain my position", amount: "100" }, controller.signal)
    [Symbol.asyncIterator]();
  await expect(stream.next()).rejects.toThrow();
});
