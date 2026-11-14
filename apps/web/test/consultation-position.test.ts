import { expect, it } from "vitest";
import { createDemoPosition } from "../src/play/source/demoPosition";

it("derives the original fixture numbers and preserves cached snapshots between changes", () => {
  const position = createDemoPosition(() => 1_000_000_000n);
  const initial = position.port.getSnapshot();
  expect(position.port.provenance).toBe("simulated");
  expect(initial.debt).toBe(1_800_000_000n);
  expect(initial.current.health).toBe(15833);
  expect(position.port.getSnapshot()).toBe(initial);
  const advice = position.port.advice("100");
  expect(advice.card?.ok && advice.card.value.amount).toBe(100_000_000n);
  expect(advice.comp.ok && advice.comp.value.value.repaySaves).toBe(21_000_000n);
  let changes = 0;
  const unsubscribe = position.port.subscribe(() => {
    changes++;
  });
  position.repay(100_000_000n);
  expect(position.port.getSnapshot().current.health).toBe(16764);
  expect(changes).toBe(1);
  unsubscribe();
  position.reset();
  expect(changes).toBe(1);
});
it("refuses stale advice and invalid amounts without changing debt", () => {
  const position = createDemoPosition(() => 1_000_000_000n);
  position.port.selectDataState("stale");
  expect(position.port.advice("100").card?.ok).toBe(false);
  expect(position.port.advice("-1").card).toBeNull();
  expect(position.port.getSnapshot().debt).toBe(1_800_000_000n);
});
