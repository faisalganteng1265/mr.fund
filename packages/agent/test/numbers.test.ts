import { describe, expect, it } from "vitest";
import {
  checkNumbers,
  enforceNumbers,
  extractNumbers,
  fromAtomic,
  percentFromBps,
  ratioFromBps,
  type SourceNumber,
} from "../src/numbers";

const src = (value: string, unit: string | null = null): SourceNumber => ({ value, unit });

const sources: SourceNumber[] = [
  ratioFromBps(14250n), // health 1.425
  percentFromBps(15000n), // 150%
  fromAtomic(200_000_000n, 6, "USDC"), // 200 USDC
  fromAtomic(1_234_567_890n, 6, "USDC"), // 1234.56789 USDC
  src("5", "USD"),
  src("45", "s"),
];

describe("extractNumbers", () => {
  it("reads both locale formats", () => {
    const toks = extractNumbers("1.234,5 and 1,234.5");
    expect(toks.map((t) => t.candidates.map((c) => `${c.int}/${c.scale}`))).toEqual([
      ["12345/1"],
      ["12345/1"],
    ]);
  });

  it("offers both readings of an ambiguous single separator", () => {
    const [tok] = extractNumbers("1.234");
    expect(tok?.candidates.map((c) => `${c.int}/${c.scale}`).sort()).toEqual(["1234/0", "1234/3"]);
  });

  it("does not read digits glued to words", () => {
    expect(extractNumbers("wNEAR2 and v3x")).toEqual([]);
  });

  it("drops a sentence-final period", () => {
    const [tok] = extractNumbers("Health is 1.42.");
    expect(tok?.text).toBe("1.42");
  });

  it("detects percent, dollar and symbol units", () => {
    const toks = extractNumbers("150% and $5 and 200 USDC");
    expect(toks.map((t) => t.unit)).toEqual(["%", "USD", "USDC"]);
  });
});

describe("checkNumbers", () => {
  it("passes a correct reply", () => {
    const r = checkNumbers("Your health is 1.42 (150% target) with 200 USDC of debt.", sources);
    expect(r.ok).toBe(true);
  });

  it("fails an invented rate", () => {
    const r = checkNumbers("Your borrow rate is 7.3%.", sources);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toEqual(["7.3%"]);
  });

  it.each([".99%", ",99%", "-.99%", "−,99%", "$.99", ".99 USDC"])(
    "rejects unsupported leading-decimal claims: %s",
    (claim) => {
      expect(checkNumbers(`The quoted amount is ${claim}.`, []).ok).toBe(false);
    },
  );

  it("matches leading decimals against the same exact value and unit", () => {
    expect(checkNumbers("Rate: .99%.", [src("0.99", "%")]).ok).toBe(true);
    expect(checkNumbers("Rate: ,99%.", [src("0.99", "%")]).ok).toBe(true);
    expect(checkNumbers("Rate: -.99%.", [src("-0.99", "%")]).ok).toBe(true);
    expect(checkNumbers("Rate: -.99%.", [src("0.99", "%")]).ok).toBe(false);
    expect(checkNumbers("Price: $.99.", [src("0.99", "USD")]).ok).toBe(true);
    expect(checkNumbers("Debt: .99 USDC.", [src("99", "USDC")]).ok).toBe(false);
  });

  it("passes Indonesian formatting", () => {
    const r = checkNumbers("Utangmu 1.234,57 USDC.", sources);
    expect(r.ok).toBe(true);
  });

  it("passes English thousands formatting", () => {
    expect(checkNumbers("Debt is 1,234.57 USDC.", sources).ok).toBe(true);
  });

  it("reads repeated separators as thousands groups and rejects bad grouping", () => {
    const big = [fromAtomic(1_234_567n, 0, "USDC")];
    expect(checkNumbers("Debt is 1.234.567 USDC.", big).ok).toBe(true);
    expect(checkNumbers("Debt is 1,234,567 USDC.", big).ok).toBe(true);
    expect(checkNumbers("Debt is 1.23.4 USDC.", big).ok).toBe(false);
  });

  it("accepts rounding to the displayed precision, floor or half-up", () => {
    expect(checkNumbers("1.4", sources).ok).toBe(true); // 1.425 -> 1.4
    expect(checkNumbers("1.43", sources).ok).toBe(true); // half-up
    expect(checkNumbers("1.42", sources).ok).toBe(true); // floor
    expect(checkNumbers("1.44", sources).ok).toBe(false);
    expect(checkNumbers("1.41", sources).ok).toBe(false);
  });

  it("does not accept a number printed with more precision than the source has", () => {
    expect(checkNumbers("1.4251", sources).ok).toBe(false);
  });

  it("compares percentages with a percent source only", () => {
    // 200 exists only as USDC, never as a percentage
    const r = checkNumbers("The ratio is 200%.", sources);
    expect(r.ok).toBe(false);
  });

  it("compares symbol-bearing amounts with that symbol only", () => {
    // 150 exists as a percentage, not as USDC
    expect(checkNumbers("You owe 150 USDC.", sources).ok).toBe(false);
    expect(checkNumbers("You owe 200 USDC.", sources).ok).toBe(true);
  });

  it("compares dollar amounts with USD sources only", () => {
    expect(checkNumbers("NEAR is $5.", sources).ok).toBe(true);
    expect(checkNumbers("NEAR is $6.", sources).ok).toBe(false);
  });

  it("treats a negative sign as a claim that the source is negative", () => {
    const s = [src("-20", "%")];
    expect(checkNumbers("A -20% move.", s).ok).toBe(true);
    expect(checkNumbers("A 20% drop.", s).ok).toBe(true);
    expect(checkNumbers("A -20% move.", [src("20", "%")]).ok).toBe(false);
  });

  it("allows small counts and ordinals from the prose allowlist", () => {
    expect(checkNumbers("I see 2 options. The 1st is cheaper.", []).ok).toBe(true);
  });

  it("does not allow other bare integers from the allowlist", () => {
    const r = checkNumbers("You have 7 options.", []);
    expect(r.ok).toBe(false);
  });

  it("does not let the allowlist excuse a unit-bearing number", () => {
    expect(checkNumbers("Fee is 2%.", []).ok).toBe(false);
    expect(checkNumbers("Fee is 2 USDC.", []).ok).toBe(false);
  });

  it("allows caller-supplied literals such as today's date", () => {
    const r = checkNumbers("As of 2026-11-05 all is calm.", [], {
      allowedLiterals: ["2026-11-05"],
    });
    expect(r.ok).toBe(true);
    expect(checkNumbers("As of 2026-11-05 all is calm.", []).ok).toBe(false);
  });

  it("reports every violation once, in order", () => {
    const r = checkNumbers("Rate 7.3% and 9.9%, health 1.42, again 7.3%.", sources);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toEqual(["7.3%", "9.9%"]);
  });

  it("passes a reply with no numbers", () => {
    expect(checkNumbers("All calm, nothing to do.", []).ok).toBe(true);
  });

  it("reads a unit-less number against any source value", () => {
    expect(checkNumbers("Data is 45 seconds old.", sources).ok).toBe(true);
    expect(checkNumbers("Data is 46 seconds old.", sources).ok).toBe(false);
  });
});

describe("source helpers", () => {
  it("fromAtomic is exact", () => {
    expect(fromAtomic(1_234_567_890n, 6, "USDC")).toEqual({ value: "1234.56789", unit: "USDC" });
    expect(fromAtomic(5n, 6, "USDC")).toEqual({ value: "0.000005", unit: "USDC" });
    expect(fromAtomic(0n, 6, "USDC")).toEqual({ value: "0", unit: "USDC" });
    expect(fromAtomic(7n, 0, "X")).toEqual({ value: "7", unit: "X" });
  });

  it("fromAtomic rejects a negative amount", () => {
    expect(() => fromAtomic(-1n, 6, "USDC")).toThrow(RangeError);
  });

  it("percentFromBps and ratioFromBps are exact", () => {
    expect(percentFromBps(12050n)).toEqual({ value: "120.5", unit: "%" });
    expect(ratioFromBps(14250n)).toEqual({ value: "1.425", unit: null });
    expect(percentFromBps(0n)).toEqual({ value: "0", unit: "%" });
  });
});

describe("enforceNumbers", () => {
  const template = () => "Template answer: health 1.42.";

  it("returns a clean first reply untouched", async () => {
    let calls = 0;
    const out = await enforceNumbers({
      reply: "Health is 1.42.",
      sources,
      regenerate: async () => {
        calls++;
        return "x";
      },
      template,
    });
    expect(out).toEqual({ text: "Health is 1.42.", via: "model", hits: 0 });
    expect(calls).toBe(0);
  });

  it("regenerates once, naming the violations", async () => {
    let seen: string[] = [];
    const out = await enforceNumbers({
      reply: "Rate is 7.3%.",
      sources,
      regenerate: async (violations) => {
        seen = violations;
        return "Health is 1.42.";
      },
      template,
    });
    expect(seen).toEqual(["7.3%"]);
    expect(out).toEqual({ text: "Health is 1.42.", via: "model", hits: 1 });
  });

  it("falls back to the template after a second failure", async () => {
    let calls = 0;
    const out = await enforceNumbers({
      reply: "Rate is 7.3%.",
      sources,
      regenerate: async () => {
        calls++;
        return "Rate is 8.1%.";
      },
      template,
    });
    expect(calls).toBe(1);
    expect(out).toEqual({ text: "Template answer: health 1.42.", via: "template", hits: 2 });
  });

  it("falls back to the template when regeneration throws", async () => {
    const out = await enforceNumbers({
      reply: "Rate is 7.3%.",
      sources,
      regenerate: async () => {
        throw new Error("llm down");
      },
      template,
    });
    expect(out.via).toBe("template");
    expect(out.hits).toBe(1);
  });
});
