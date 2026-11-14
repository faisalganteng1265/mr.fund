import { describe, expect, it } from "vitest";
import { chatOutputViolations, normalizeReplyDashes } from "../src/chat-output";
import { checkNumbers, extractNumbers } from "../src/numbers";
import { buildPersonaPrompt } from "../src/persona";

describe("reply dash normalization before provenance checking", () => {
  it.each([
    "Range 5–10 USDC",
    "Range 5—10 USDC",
    "Health — 150.25%; shock –20%",
    "Debt −10 USDC, or -10 USDC",
    "5–10.25 USDC; 1.234,5—2.345,6 USD",
  ])("preserves numeric readings of %s", (input) => {
    const normalized = normalizeReplyDashes(input);
    expect(normalized).not.toMatch(/[—–]/);
    const readings = (text: string) =>
      extractNumbers(text, ["USDC", "USD"]).map(({ neg, candidates, unit }) => ({
        neg,
        candidates,
        unit,
      }));
    expect(readings(normalized)).toEqual(readings(input));
  });
  it("keeps a range endpoint positive and requires its source", () => {
    const text = normalizeReplyDashes("5–10 USDC");
    expect(
      checkNumbers(text, [
        { value: "5", unit: null },
        { value: "10", unit: "USDC" },
      ]),
    ).toEqual({ ok: true });
    expect(checkNumbers(text, [{ value: "5", unit: null }])).toEqual({
      ok: false,
      violations: ["10 USDC"],
    });
  });
});

describe("guarantee violations name the matched word", () => {
  it("tells the retry which localized word was refused", () => {
    expect(
      chatOutputViolations("Faktor kesehatan adalah ukuran seberapa aman posisi Anda."),
    ).toEqual(['unsupported guarantee: "aman"']);
    expect(chatOutputViolations("Tu préstamo está seguro.")).toEqual([
      'unsupported guarantee: "seguro"',
    ]);
  });
  it("still allows a negated disclosure", () => {
    expect(chatOutputViolations("Posisi ini tidak aman jika harga turun.")).toEqual([]);
  });
});

describe("persona names the localized guarantee words", () => {
  it("lists Indonesian and Spanish words to avoid", () => {
    const prompt = buildPersonaPrompt();
    for (const word of ["aman", "terjamin", "bebas risiko", "seguro", "garantizado", "sin riesgo"])
      expect(prompt).toContain(`"${word}"`);
  });
});

describe("small integers next to a comparison need a source", () => {
  it.each([
    "Below 1, the position can be liquidated.",
    "Di bawah 1, posisi bisa dilikuidasi.",
    "Por debajo de 1, la posición puede ser liquidada.",
    "If health falls under 2 you are at risk.",
    "Kalau kurang dari 3, berhati-hatilah.",
  ])("refuses an unsourced threshold: %s", (text) => {
    expect(checkNumbers(text, [])).toMatchObject({ ok: false });
  });
  it("accepts the same sentence when a tool returned the line", () => {
    expect(
      checkNumbers("Below 1, the position can be liquidated.", [{ value: "1", unit: null }]),
    ).toEqual({ ok: true });
  });
  it("still allows small prose counts", () => {
    expect(checkNumbers("There are 2 attempts; 1 was rejected.", [])).toEqual({ ok: true });
  });
});

describe("persona: data age, repay direction and unsourced judgments", () => {
  const prompt = buildPersonaPrompt();
  it("answers data age when asked, never volunteers it", () => {
    expect(prompt).toMatch(/If the user asks for data age, state the age a tool returned/);
    expect(prompt).toMatch(/Do not volunteer data age/);
  });
  it("states the direction of repaying and forbids unsourced judgments", () => {
    expect(prompt).toMatch(
      /Repaying raises the health factor and moves the position further from liquidation/,
    );
    expect(prompt).toMatch(
      /Never call health high, low, near or far without a tool-returned number/,
    );
  });
});
