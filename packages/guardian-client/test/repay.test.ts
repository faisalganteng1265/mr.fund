import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CardDraft } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { GUARDIAN_REPAY_MSG, guardianRepayPayload } from "../src/tx/repay";

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../fixtures/encodings.json"), "utf8"),
) as {
  cases: {
    name: string;
    args_json: string;
    deposit: string;
    method: string;
    receiver_id: string;
  }[];
};
const c = vectors.cases.find((x) => x.name === "guardian_repay");

const draft = (over: Partial<CardDraft> = {}): CardDraft => ({
  action: "repay",
  headline: "Repay 50 USDC",
  numbers: [],
  assumptions: [],
  fees: [],
  risks: [],
  dataAgeMs: 0,
  maxDataAgeMs: 120_000,
  amount: 50_000_000n,
  tokenId: "usdc.fakes.testnet",
  cappedBy: null,
  ...over,
});

describe("guardianRepayPayload (G1, pending D18)", () => {
  it("sends the debt token to the Guardian with the repay message, byte for byte", () => {
    const r = guardianRepayPayload(draft(), {
      guardianId: "guardian.alice.testnet",
      recipientRegistered: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !c) return;
    const t = r.value[0];
    expect(t?.receiverId).toBe(c.receiver_id);
    expect(t?.actions[0]?.methodName).toBe(c.method);
    expect(JSON.stringify(t?.actions[0]?.args)).toBe(c.args_json);
    expect(t?.actions[0]?.deposit).toBe(BigInt(c.deposit));
    expect(GUARDIAN_REPAY_MSG).toBe('{"repay":{}}');
  });

  it("refuses a bad Guardian id and a non-repay card", () => {
    expect(guardianRepayPayload(draft(), { guardianId: "X", recipientRegistered: true }).ok).toBe(
      false,
    );
    expect(
      guardianRepayPayload(draft({ action: "guardian_withdraw" }), {
        guardianId: "guardian.alice.testnet",
        recipientRegistered: true,
      }).ok,
    ).toBe(false);
  });

  it("appends the fee transfer after the repay", () => {
    const fee = {
      label: "Execution fee",
      amount: 1n,
      tokenId: "usdc.fakes.testnet",
      recipientId: "fees.testnet",
      when: "x",
    };
    const r = guardianRepayPayload(draft({ fees: [fee] }), {
      guardianId: "guardian.alice.testnet",
      recipientRegistered: true,
    });
    expect(r.ok && r.value.map((t) => t.actions[0]?.methodName)).toEqual([
      "ft_transfer_call",
      "ft_transfer",
    ]);
  });
});
