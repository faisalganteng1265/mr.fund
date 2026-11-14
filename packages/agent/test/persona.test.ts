import { describe, expect, it } from "vitest";
import { enforceNumbers } from "../src/numbers";
import { findBannedPhrases } from "../src/persona";

describe("findBannedPhrases", () => {
  it.each([
    ["You will never get liquidated with me.", "never get liquidated"],
    ["You will never be liquidated.", "never get liquidated"],
    ["Guaranteed yield of the week.", "guaranteed yield"],
    ["Your money is safe here.", "safe"],
    ["SAFE!", "safe"],
    ["A risk-free move.", "risk-free"],
    ["A risk free move.", "risk-free"],
    ["Enjoy free borrowing today.", "free borrowing"],
  ])("flags %s", (text, label) => {
    expect(findBannedPhrases(text)).toEqual([label]);
  });

  it.each([
    "Nothing to do, health is calm.",
    "That would be unsafe to promise.",
    "I can't promise that.",
    "It reduces liquidation risk within limits you set.",
    "We never touch your keys.",
  ])("lets %s through", (text) => {
    expect(findBannedPhrases(text)).toEqual([]);
  });

  it("reports each banned phrase once, in list order", () => {
    expect(findBannedPhrases("safe, risk-free, safe and guaranteed yield")).toEqual([
      "guaranteed yield",
      "safe",
      "risk-free",
    ]);
  });
});

describe("banned phrases in the reply guard", () => {
  const template = () => "Template.";
  const extraViolations = findBannedPhrases;

  it("treats a banned phrase like an unsourced number: regenerate once", async () => {
    let seen: string[] = [];
    const out = await enforceNumbers({
      reply: "You are safe.",
      sources: [],
      extraViolations,
      regenerate: async (v) => {
        seen = v;
        return "Health looks fine.";
      },
      template,
    });
    expect(seen).toEqual(["safe"]);
    expect(out).toEqual({ text: "Health looks fine.", via: "model", hits: 1 });
  });

  it("falls back to the template if the retry is still banned", async () => {
    const out = await enforceNumbers({
      reply: "You are safe.",
      sources: [],
      extraViolations,
      regenerate: async () => "Totally risk-free.",
      template,
    });
    expect(out).toEqual({ text: "Template.", via: "template", hits: 2 });
  });

  it("reports number and phrase violations together", async () => {
    let seen: string[] = [];
    await enforceNumbers({
      reply: "Rate 7.3%, risk-free.",
      sources: [],
      extraViolations,
      regenerate: async (v) => {
        seen = v;
        return "ok";
      },
      template,
    });
    expect(seen).toEqual(["7.3%", "risk-free"]);
  });
});
