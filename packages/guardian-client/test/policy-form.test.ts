import type { GuardianPolicy } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import {
  type PolicyFields,
  parsePolicyForm,
  policyChangeSummary,
  policyFields,
} from "../src/activation-form";

const token = { symbol: "REF", decimals: 6 };
const current: GuardianPolicy = {
  maxPerAction: 50_000n,
  lifetimeCap: 100_000n,
  reserveFloor: 20_000n,
  triggerHfBps: 12_000,
  targetHfBps: null,
  cooldownSec: 300,
  actionFee: 4_000n,
};
const ctx = { decimals: 6, actionFee: current.actionFee, spentTotal: 17_600n };
const base: PolicyFields = {
  maxPerAction: "0.05",
  lifetimeCap: "0.1",
  reserveFloor: "0.02",
  trigger: "200",
  target: "",
  cooldownMinutes: "5",
};
const parse = (over: Partial<PolicyFields> = {}) => parsePolicyForm({ ...base, ...over }, ctx);
const fieldsOf = (r: ReturnType<typeof parse>) => (r.ok ? [] : r.errors.map((e) => e.field));

describe("parsePolicyForm", () => {
  it("builds the exact policy and keeps the fee the Guardian already runs with", () => {
    expect(parse()).toEqual({
      ok: true,
      value: { ...current, triggerHfBps: 20_000 },
    });
  });

  it("an empty target means no target", () => {
    const r = parse({ target: "" });
    expect(r.ok && r.value.targetHfBps).toBe(null);
  });

  it("reads a target above the trigger exactly, to two decimals", () => {
    const r = parse({ trigger: "200", target: "250.25" });
    expect(r.ok && r.value.targetHfBps).toBe(25_025);
  });

  it.each([
    ["a trigger below the contract minimum", { trigger: "104.99" }, "trigger"],
    ["a trigger that is not a number", { trigger: "abc" }, "trigger"],
    ["a trigger with three decimals", { trigger: "120.123" }, "trigger"],
    ["a target at the trigger", { trigger: "200", target: "200" }, "target"],
    ["a target below the trigger", { trigger: "200", target: "150" }, "target"],
    ["a cooldown under five minutes", { cooldownMinutes: "4" }, "cooldownMinutes"],
    ["a fractional cooldown", { cooldownMinutes: "5.5" }, "cooldownMinutes"],
    ["a zero max per action", { maxPerAction: "0" }, "maxPerAction"],
    ["a max per action with too many decimals", { maxPerAction: "0.0000001" }, "maxPerAction"],
    ["a max total below max per action", { lifetimeCap: "0.04" }, "lifetimeCap"],
    ["a max total that is empty", { lifetimeCap: "" }, "lifetimeCap"],
    ["a reserve floor that is not a number", { reserveFloor: "-1" }, "reserveFloor"],
  ] as const)("refuses %s on the field to change", (_name, over, field) => {
    expect(fieldsOf(parse(over))).toContain(field);
  });

  it("refuses a max total below what the Guardian has already spent", () => {
    // 0.0176 REF is spent; a cap of 0.017 would be below it even though it covers one action.
    const r = parsePolicyForm({ ...base, maxPerAction: "0.01", lifetimeCap: "0.017" }, ctx);
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toEqual(["lifetimeCap"]);
  });

  it("accepts a max total exactly equal to what was spent", () => {
    const r = parsePolicyForm({ ...base, maxPerAction: "0.01", lifetimeCap: "0.0176" }, ctx);
    expect(r.ok && r.value.lifetimeCap).toBe(17_600n);
  });
});

describe("policyFields", () => {
  it("round-trips the current policy through the form unchanged", () => {
    const fields = policyFields(current, token.decimals);
    expect(fields).toEqual({
      maxPerAction: "0.05",
      lifetimeCap: "0.1",
      reserveFloor: "0.02",
      trigger: "120",
      target: "",
      cooldownMinutes: "5",
    });
    expect(parsePolicyForm(fields, ctx)).toEqual({ ok: true, value: current });
  });

  it("round-trips a target and fractional percent", () => {
    const withTarget = { ...current, triggerHfBps: 10_550, targetHfBps: 15_025 };
    const fields = policyFields(withTarget, token.decimals);
    expect(fields.trigger).toBe("105.5");
    expect(fields.target).toBe("150.25");
    expect(parsePolicyForm(fields, ctx)).toEqual({ ok: true, value: withTarget });
  });
});

describe("policyChangeSummary", () => {
  it("names only what changes, with the old and the new value", () => {
    const next = { ...current, triggerHfBps: 20_000, cooldownSec: 600 };
    expect(policyChangeSummary(current, next, token)).toEqual([
      "Act below health: 120% → 200%.",
      "Cooldown: 5 → 10 minutes.",
    ]);
  });

  it("states amounts in the token and a removed target in words", () => {
    const before = { ...current, targetHfBps: 15_000 };
    const next = { ...before, maxPerAction: 30_000n, targetHfBps: null };
    expect(policyChangeSummary(before, next, token)).toEqual([
      "Max per action: 0.05 REF → 0.03 REF.",
      "Aim for health: 150% → none.",
    ]);
  });

  it("says so when nothing changes", () => {
    expect(policyChangeSummary(current, { ...current }, token)).toEqual([]);
  });
});
