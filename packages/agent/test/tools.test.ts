import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatch, sourcesOf, toToolMessage } from "../src/dispatch";
import { checkNumbers } from "../src/numbers";
import { findBannedPhrases } from "../src/persona";
import { GLOSSARY_TERMS, TOOL_NAMES, type ToolResult, toolDefinitions } from "../src/tools";
import { baseSnapshot, NOW, WNEAR } from "./fixture";

const ctx = { snapshot: baseSnapshot(), nowMs: NOW };
const positionResult = await dispatch({ name: "get_position", arguments: {} }, ctx);

function ok(r: ToolResult) {
  if (!r.ok) throw new Error(`expected ok, got refusal ${r.refusal.code}: ${r.refusal.message}`);
  return r;
}
const fact = (r: ToolResult, label: string) => ok(r).facts.find((f) => f.label === label);

describe("get_position", () => {
  const r = positionResult;

  it("returns health as a ratio and a percentage", async () => {
    expect(fact(r, "health factor")).toEqual({
      label: "health factor",
      value: "1.425",
      unit: null,
    });
    expect(fact(r, "health factor (percent)")).toEqual({
      label: "health factor (percent)",
      value: "142.5",
      unit: "%",
    });
  });

  it("returns collateral, debt, price and rates in whole units", async () => {
    expect(fact(r, "wNEAR collateral")?.value).toBe("100");
    expect(fact(r, "wNEAR collateral")?.unit).toBe("wNEAR");
    expect(fact(r, "USDC debt")).toEqual({ label: "USDC debt", value: "200", unit: "USDC" });
    expect(fact(r, "wNEAR price")).toEqual({ label: "wNEAR price", value: "5", unit: "USD" });
    expect(fact(r, "USDC borrow rate")).toEqual({
      label: "USDC borrow rate",
      value: "21",
      unit: "%",
    });
  });

  it("returns the liquidation price of the collateral, rounded up", async () => {
    const f = fact(r, "wNEAR liquidation price");
    expect(f?.unit).toBe("USD");
    expect(f?.value.startsWith("3.508")).toBe(true);
  });

  it("states the data age", async () => {
    expect(ok(r).dataAgeMs).toBe(0);
    expect(fact(r, "data age")).toEqual({ label: "data age", value: "0", unit: "s" });
    const later = await dispatch(
      { name: "get_position", arguments: {} },
      { ...ctx, nowMs: NOW + 45_000 },
    );
    expect(fact(later, "data age")?.value).toBe("45");
  });

  it("omits the liquidation price when other collateral covers the debt", async () => {
    const base = baseSnapshot();
    const wn = base.assets[WNEAR];
    const wp = base.prices[WNEAR];
    if (!wn || !wp) throw new Error("fixture");
    const OTHER = "other.testnet";
    const s = baseSnapshot({
      collateral: [...base.collateral, { tokenId: OTHER, internal: 1_000_000n * 10n ** 24n }],
      assets: {
        ...base.assets,
        [OTHER]: { ...wn, token: { ...wn.token, id: OTHER, symbol: "OTHR" } },
      },
      prices: { ...base.prices, [OTHER]: wp },
    });
    const out = await dispatch(
      { name: "get_position", arguments: {} },
      { snapshot: s, nowMs: NOW },
    );
    expect(fact(out, "wNEAR liquidation price")).toBeUndefined();
    expect(fact(out, "OTHR liquidation price")).toBeUndefined();
    expect(ok(out).notes.join(" ")).toMatch(/no liquidation price/);
  });

  it("is not a scenario", async () => {
    expect(ok(r).scenario).toBe(false);
  });

  it("refuses with the reason when prices are stale", async () => {
    const later = NOW + 600_000;
    const snapshot = baseSnapshot({ readAtMs: later });
    const stale = await dispatch(
      { name: "get_position", arguments: {} },
      { snapshot, nowMs: later },
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.refusal.code).toBe("stale_price");
  });

  it("refuses with the reason when the read itself is old", async () => {
    const stale = await dispatch(
      { name: "get_position", arguments: {} },
      { ...ctx, nowMs: NOW + 600_000 },
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.refusal.code).toBe("stale_snapshot");
  });

  it("says there is no debt instead of inventing a health factor", async () => {
    const s = baseSnapshot({ borrowed: [] });
    const out = await dispatch(
      { name: "get_position", arguments: {} },
      { snapshot: s, nowMs: NOW },
    );
    expect(fact(out, "health factor")).toBeUndefined();
    expect(ok(out).text.health).toBe("no debt");
  });

  it("rejects unexpected arguments", async () => {
    const out = await dispatch({ name: "get_position", arguments: { accountId: "bob.near" } }, ctx);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.refusal.code).toBe("invalid_arguments");
  });
});

describe("compare_repay_vs_yield", () => {
  it("defaults to the whole debt over 365 days", async () => {
    const r = await dispatch({ name: "compare_repay_vs_yield", arguments: {} }, ctx);
    expect(fact(r, "amount compared")).toEqual({
      label: "amount compared",
      value: "200",
      unit: "USDC",
    });
    expect(fact(r, "repaying saves")?.value).toBe("42");
    expect(fact(r, "yield earns")?.value).toBe("28.02");
    expect(fact(r, "horizon")).toEqual({ label: "horizon", value: "365", unit: "days" });
    expect(ok(r).text.winner).toBe("repay");
  });

  it("takes a whole-unit amount and caps it at the debt", async () => {
    const r = await dispatch(
      { name: "compare_repay_vs_yield", arguments: { amount: "50", horizonDays: 30 } },
      ctx,
    );
    expect(fact(r, "amount compared")?.value).toBe("50");
    const big = await dispatch(
      { name: "compare_repay_vs_yield", arguments: { amount: "999" } },
      ctx,
    );
    expect(fact(big, "amount compared")?.value).toBe("200");
    expect(ok(big).notes.join(" ")).toMatch(/capped/);
  });

  it("accepts a numeric amount", async () => {
    const r = await dispatch({ name: "compare_repay_vs_yield", arguments: { amount: 50 } }, ctx);
    expect(fact(r, "amount compared")?.value).toBe("50");
  });

  it.each([["abc"], ["-1"], ["0"], ["1.1234567"], [""], ["1e3"], [null]])(
    "refuses amount %j",
    async (amount) => {
      const r = await dispatch({ name: "compare_repay_vs_yield", arguments: { amount } }, ctx);
      expect(r.ok).toBe(false);
    },
  );

  it.each([[0], [1.5], [4000], ["30"], [-3]])("refuses horizon %j", async (horizonDays) => {
    const r = await dispatch({ name: "compare_repay_vs_yield", arguments: { horizonDays } }, ctx);
    expect(r.ok).toBe(false);
  });

  it("checks the horizon bounds itself", async () => {
    const at = async (horizonDays: number) =>
      await dispatch({ name: "compare_repay_vs_yield", arguments: { horizonDays } }, ctx);
    expect((await at(3650)).ok).toBe(true);
    const over = await at(3651);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.refusal.code).toBe("invalid_arguments");
  });

  it("refuses when there is no debt", async () => {
    const s = baseSnapshot({ borrowed: [] });
    const r = await dispatch(
      { name: "compare_repay_vs_yield", arguments: {} },
      { snapshot: s, nowMs: NOW },
    );
    expect(r.ok).toBe(false);
  });

  it("refuses a token that is not borrowed or unknown", async () => {
    const r = await dispatch({ name: "compare_repay_vs_yield", arguments: { token: "DOGE" } }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe("unsupported_asset");
  });
});

describe("what_if_price", () => {
  const call = async (shocks: unknown) =>
    await dispatch({ name: "what_if_price", arguments: { shocks } }, ctx);

  it("computes health under a drop and labels it a scenario", async () => {
    const r = await call([{ token: "wNEAR", changePercent: -20 }]);
    expect(fact(r, "scenario health factor")?.value).toBe("1.14");
    expect(fact(r, "scenario health factor (percent)")?.value).toBe("114");
    expect(fact(r, "wNEAR price change")).toEqual({
      label: "wNEAR price change",
      value: "-20",
      unit: "%",
    });
    expect(ok(r).scenario).toBe(true);
    expect(ok(r).text.liquidatable).toBe("no");
  });

  it("flags liquidation below 100%", async () => {
    const r = await call([{ token: "wNEAR", changePercent: -40 }]);
    expect(fact(r, "scenario health factor")?.value).toBe("0.855");
    expect(ok(r).text.liquidatable).toBe("yes");
  });

  it("accepts a token id and a fractional percent", async () => {
    const r = await call([{ token: WNEAR, changePercent: -20.5 }]);
    expect(fact(r, "wNEAR price change")?.value).toBe("-20.5");
  });

  it("rejects -99% (the engine bound)", async () => {
    const r = await call([{ token: "wNEAR", changePercent: -99 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe("invalid_amount");
  });

  it("rejects above +500%", async () => {
    expect((await call([{ token: "wNEAR", changePercent: 501 }])).ok).toBe(false);
    expect((await call([{ token: "wNEAR", changePercent: 500 }])).ok).toBe(true);
  });

  it.each([
    [[]],
    ["nope"],
    [[{ token: "wNEAR" }]],
    [[{ changePercent: -10 }]],
    [[{ token: "wNEAR", changePercent: "ten" }]],
    [[{ token: "wNEAR", changePercent: Number.NaN }]],
    [[{ token: "wNEAR", changePercent: -20.123 }]],
    [[{ token: "wNEAR", changePercent: -10, extra: 1 }]],
    [Array.from({ length: 9 }, () => ({ token: "wNEAR", changePercent: -1 }))],
  ])("refuses malformed shocks %j", async (shocks) => {
    const r = await call(shocks);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe("invalid_arguments");
  });

  it("bounds the number of shocks itself", async () => {
    const r = await call(Array.from({ length: 9 }, () => ({ token: "wNEAR", changePercent: -1 })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe("invalid_arguments");
  });

  it("refuses an unknown token and a duplicate shock", async () => {
    expect((await call([{ token: "DOGE", changePercent: -10 }])).ok).toBe(false);
    expect(
      (
        await call([
          { token: "wNEAR", changePercent: -10 },
          { token: "wNEAR", changePercent: -20 },
        ])
      ).ok,
    ).toBe(false);
  });
});

const LINE_TERMS = ["health_factor", "liquidation", "liquidation_price"];

describe("explain_term", () => {
  it.each(GLOSSARY_TERMS)(
    "explains %s in plain words with no numbers or banned claims",
    async (term) => {
      const r = await dispatch({ name: "explain_term", arguments: { term } }, ctx);
      const text = ok(r).text.explanation ?? "";
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/\d/);
      expect(findBannedPhrases(text)).toEqual([]);
      // Terms that name the liquidation line carry it as an engine fact, so a model may quote it.
      expect(ok(r).facts).toEqual(
        LINE_TERMS.includes(term)
          ? [
              { label: "health factor at the liquidation line", value: "1", unit: null },
              { label: "health factor at the liquidation line", value: "100", unit: "%" },
            ]
          : [],
      );
    },
  );

  it("refuses a term outside the glossary", async () => {
    const r = await dispatch({ name: "explain_term", arguments: { term: "moon" } }, ctx);
    expect(r.ok).toBe(false);
  });
});

describe("dispatch", () => {
  it("refuses an unknown tool", async () => {
    const r = await dispatch({ name: "send_transaction", arguments: {} }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe("unknown_tool");
  });

  it("refuses non-object arguments", async () => {
    for (const args of ["x", 3, [], true]) {
      const r = await dispatch({ name: "what_if_price", arguments: args }, ctx);
      expect(r.ok).toBe(false);
    }
  });

  it("treats missing arguments as empty for no-argument tools", async () => {
    expect((await dispatch({ name: "get_position", arguments: undefined }, ctx)).ok).toBe(true);
    expect((await dispatch({ name: "get_position", arguments: null }, ctx)).ok).toBe(true);
  });

  it("does not resolve inherited object properties as tools", async () => {
    for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      const r = await dispatch({ name, arguments: {} }, ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.refusal.code).toBe("unknown_tool");
    }
  });

  it("never throws on hostile input", async () => {
    const hostile: unknown[] = [undefined, null, 1, "x", [], {}, { __proto__: { a: 1 } }];
    for (const name of [...TOOL_NAMES, "nope"]) {
      for (const args of hostile) {
        await expect(dispatch({ name, arguments: args }, ctx)).resolves.toHaveProperty("ok");
      }
    }
  });
});

describe("tool message", () => {
  it("is valid JSON with only strings for numbers", async () => {
    const r = await dispatch({ name: "get_position", arguments: {} }, ctx);
    const parsed = JSON.parse(toToolMessage(r));
    expect(parsed.ok).toBe(true);
    for (const f of parsed.facts) expect(typeof f.value).toBe("string");
  });

  it("marks a scenario and carries a refusal reason", async () => {
    const sc = JSON.parse(
      toToolMessage(
        await dispatch(
          {
            name: "what_if_price",
            arguments: { shocks: [{ token: "wNEAR", changePercent: -10 }] },
          },
          ctx,
        ),
      ),
    );
    expect(sc.scenario).toBe(true);
    const bad = JSON.parse(toToolMessage(await dispatch({ name: "nope", arguments: {} }, ctx)));
    expect(bad).toEqual({
      ok: false,
      tool: "nope",
      refusal: { code: "unknown_tool", message: expect.any(String) },
    });
  });
});

describe("tool results feed the number checker", () => {
  const r = positionResult;

  it("a correct reply passes", async () => {
    const reply =
      "Health is 1.42 (142.5%), you owe 200 USDC and NEAR is $5. Data is 0 seconds old.";
    expect(checkNumbers(reply, sourcesOf(r)).ok).toBe(true);
  });

  it("an invented number fails", async () => {
    expect(checkNumbers("You owe 250 USDC.", sourcesOf(r)).ok).toBe(false);
    expect(checkNumbers("Your borrow rate is 9%.", sourcesOf(r)).ok).toBe(false);
  });

  it("a refusal contributes no numbers", async () => {
    expect(sourcesOf(await dispatch({ name: "nope", arguments: {} }, ctx))).toEqual([]);
  });

  it("combines several results of one turn", async () => {
    const a = await dispatch({ name: "compare_repay_vs_yield", arguments: {} }, ctx);
    const all = [...sourcesOf(r), ...sourcesOf(a)];
    expect(checkNumbers("Repaying saves 42 USDC against 28.02 USDC of yield.", all).ok).toBe(true);
  });
});

describe("registry", () => {
  it("exposes exactly the tools implemented so far", async () => {
    expect([...TOOL_NAMES].sort()).toEqual([
      "compare_repay_vs_yield",
      "explain_term",
      "get_position",
      "guardian_history",
      "guardian_status",
      "propose_card",
      "propose_opening",
      "quote_opening",
      "what_if_price",
    ]);
    expect(
      toolDefinitions()
        .map((d) => d.name)
        .sort(),
    ).toEqual([...TOOL_NAMES].sort());
  });

  it("describes each tool with a closed object schema", async () => {
    for (const d of toolDefinitions()) {
      expect(d.description.length).toBeGreaterThan(10);
      expect(d.parameters.type).toBe("object");
      expect(d.parameters.additionalProperties).toBe(false);
    }
  });

  it("has no tool that can sign, send or change a policy", async () => {
    const banned = /sign|send|transfer|submit|broadcast|policy|withdraw|execute/i;
    for (const name of TOOL_NAMES) expect(name).not.toMatch(banned);
  });

  it("imports no signer or NEAR client anywhere in the agent package", async () => {
    const dir = join(import.meta.dirname, "../src");
    const imp = /from\s+["'](near-api-js|@near-js\/|near-kit|@hot-labs|@near-wallet-selector)/;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(imp);
    }
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(
      deps.filter((d) => /near-api-js|@near-js|near-kit|hot-labs|wallet-selector/.test(d)),
    ).toEqual([]);
  });
});
