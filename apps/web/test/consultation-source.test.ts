import type { Card, CardReceipt, PositionSnapshot } from "@mrfund/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ChatEvent,
  ConsultationSource,
  ExecutionEvent,
  Provenance,
} from "../src/play/source/types";

describe("consultation capability contract", () => {
  it("keeps capability provenance independent and snapshots subscribable", () => {
    const store = <T>(value: T) => ({
      getSnapshot: () => value,
      subscribe: (_listener: () => void) => () => {},
    });
    const fake = {
      session: {
        provenance: "live",
        ...store({ connected: false, connecting: false, walletBalance: 0n }),
        connect: async () => {},
        disconnect: () => {},
      },
      position: { provenance: "simulated" },
      chat: {
        provenance: "simulated",
        async *send(_request: { message: string }, signal: AbortSignal) {
          signal.throwIfAborted();
          yield { type: "text", text: "reply" } as const;
        },
      },
      execution: { provenance: "simulated" },
      guardian: { provenance: "simulated" },
    };
    expectTypeOf(fake.session.provenance).toEqualTypeOf<string>();
    expectTypeOf<ConsultationSource["session"]["provenance"]>().toEqualTypeOf<Provenance>();
    expectTypeOf<ConsultationSource["position"]["getSnapshot"]>()
      .returns.toHaveProperty("snapshot")
      .toEqualTypeOf<PositionSnapshot>();
    expectTypeOf<Extract<ChatEvent, { type: "card" }>["card"]>().toEqualTypeOf<Card>();
    expectTypeOf<
      Extract<ExecutionEvent, { type: "receipt" }>["receipt"]["chain"]
    >().toEqualTypeOf<CardReceipt>();
    expect(fake.session.getSnapshot().walletBalance).toBe(0n);
    expect(fake.session.provenance).not.toBe(fake.position.provenance);
  });
});
