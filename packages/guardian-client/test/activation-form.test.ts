import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ActivationFields,
  activationSummary,
  parseActivationForm,
  parseDecimal,
} from "../src/activation-form";
import { createGuardianPayload, type FactoryInfo } from "../src/tx/activation";

const ctx = { decimals: 6, actionFee: 1_000_000n }; // 1 USDC per action
const base: ActivationFields = {
  maxPerAction: "100",
  lifetimeCap: "400",
  reserveFloor: "100",
  reserveDeposit: "201",
  trigger: "120",
  target: "150",
  cooldownMinutes: "5",
};
const parse = (over: Partial<ActivationFields>) => parseActivationForm({ ...base, ...over }, ctx);
const fieldsOf = (r: ReturnType<typeof parse>) => (r.ok ? [] : r.errors.map((e) => e.field));

describe("parseActivationForm: PRD F6 boundaries", () => {
  it("accepts the base form exactly", () => {
    expect(parse({})).toEqual({
      ok: true,
      value: {
        reserve: 201_000_000n,
        policy: {
          maxPerAction: 100_000_000n,
          lifetimeCap: 400_000_000n,
          reserveFloor: 100_000_000n,
          triggerHfBps: 12_000,
          targetHfBps: 15_000,
          cooldownSec: 300,
          actionFee: 1_000_000n,
        },
      },
    });
  });

  it.each([
    [{ trigger: "104.99" }, "trigger", false],
    [{ trigger: "105" }, "trigger", true],
    [{ cooldownMinutes: "4" }, "cooldownMinutes", false],
    [{ cooldownMinutes: "5" }, "cooldownMinutes", true],
    [{ reserveDeposit: "200.999999" }, "reserveDeposit", false],
    [{ reserveDeposit: "201" }, "reserveDeposit", true],
    [{ maxPerAction: "100.000001", reserveDeposit: "200" }, "maxPerAction", false],
    [{ lifetimeCap: "99.999999" }, "lifetimeCap", false],
    [{ lifetimeCap: "100" }, "lifetimeCap", true],
    [{ target: "120" }, "target", false],
    [{ target: "120.01" }, "target", true],
    [{ maxPerAction: "0" }, "maxPerAction", false],
  ])("%j → %s valid=%s", (over, field, valid) => {
    const r = parse(over);
    if (valid) expect(r.ok).toBe(true);
    else expect(fieldsOf(r)).toContain(field);
  });

  it("defaults max total to reserve minus floor and allows no target", () => {
    const r = parse({ lifetimeCap: "", target: "" });
    expect(r.ok && r.value.policy).toMatchObject({ lifetimeCap: 101_000_000n, targetHfBps: null });
  });

  it("refuses inexact or non-numeric input instead of rounding", () => {
    expect(parseDecimal("1.0000001", 6)).toBeNull();
    expect(parseDecimal("1e3", 6)).toBeNull();
    expect(parseDecimal("-1", 6)).toBeNull();
    expect(parseDecimal("0.1", 6)).toBe(100_000n);
    expect(
      fieldsOf(parse({ trigger: "120.001", cooldownMinutes: "5.5", maxPerAction: "x" })),
    ).toEqual(expect.arrayContaining(["trigger", "cooldownMinutes", "maxPerAction"]));
  });
});

describe("activationSummary: summary numbers equal payload numbers (G-UI-2)", () => {
  const factory: FactoryInfo = {
    factoryId: "factory.testnet",
    minFunding: 1n,
    maxFunding: 10n ** 30n,
    debtTokenId: "usdc.testnet",
    collateralTokenId: "wrap.testnet",
    lendingId: "rhea.testnet",
    feeRecipientId: "fees.testnet",
    activationFee: 2_500_000n,
  };
  const token = { symbol: "USDC", decimals: 6 };
  const unit = 10n ** 6n;
  const dec = (v: bigint | string) => {
    const s = BigInt(v).toString().padStart(7, "0");
    const frac = s.slice(-6).replace(/0+$/, "");
    return frac ? `${s.slice(0, -6)}.${frac}` : s.slice(0, -6);
  };

  it("holds for arbitrary valid forms", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10_000n * unit }),
        fc.bigInt({ min: 0n, max: 10_000n * unit }),
        fc.bigInt({ min: 0n, max: 10_000n * unit }),
        fc.bigInt({ min: 0n, max: 10_000n * unit }),
        fc.integer({ min: 10_500, max: 30_000 }),
        fc.option(fc.integer({ min: 1, max: 10_000 })),
        fc.integer({ min: 5, max: 10_000 }),
        (max, floor, extraDeposit, extraCap, trigger, targetGap, minutes) => {
          const deposit = max + ctx.actionFee + floor + extraDeposit;
          const fields: ActivationFields = {
            maxPerAction: dec(max),
            lifetimeCap: dec(max + extraCap),
            reserveFloor: dec(floor),
            reserveDeposit: dec(deposit),
            trigger: (trigger / 100).toFixed(2),
            target: targetGap === null ? "" : ((trigger + targetGap) / 100).toFixed(2),
            cooldownMinutes: String(minutes),
          };
          const r = parseActivationForm(fields, ctx);
          if (!r.ok) throw new Error(JSON.stringify(r.errors));
          const tx = createGuardianPayload(factory, r.value.policy, 1n, {
            ownerId: "alice.testnet",
            creationPending: false,
          });
          if (!tx.ok) throw new Error(tx.error.kind);
          const wire = tx.value[0]?.actions[0]?.args as {
            policy: Record<string, string | number | null>;
          };
          const text = activationSummary(r.value, factory, token).join("\n");
          const expected = [
            `${dec(wire.policy.max_per_action as string)} USDC per action`,
            `at most ${dec(wire.policy.lifetime_cap as string)} USDC in total`,
            `below ${dec(wire.policy.reserve_floor as string)} USDC`,
            `below ${((wire.policy.trigger_hf_bps as number) / 100).toFixed(2).replace(/\.?0+$/, "")}%`,
            `${(wire.policy.cooldown_sec as number) / 60} minutes`,
            `fee of ${dec(wire.policy.action_fee as string)} USDC`,
            `${dec(r.value.reserve)} USDC to the reserve`,
            `activation fee of ${dec(factory.activationFee)} USDC paid to fees.testnet`,
            `You send ${dec(r.value.reserve + factory.activationFee)} USDC`,
          ];
          if (wire.policy.target_hf_bps !== null)
            expected.push(
              `aiming for ${((wire.policy.target_hf_bps as number) / 100).toFixed(2).replace(/\.?0+$/, "")}%`,
            );
          for (const phrase of expected) expect(text).toContain(phrase);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("uses no banned promise", () => {
    const r = parse({});
    if (!r.ok) throw new Error("fixture");
    const text = activationSummary(r.value, factory, token).join(" ");
    expect(text).not.toMatch(/never get liquidated|guaranteed|risk-free|\bsafe\b|free borrowing/i);
  });
});
