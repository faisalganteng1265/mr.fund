import { describe, expect, it } from "vitest";
import { err, ok } from "../src/index";

describe("Result helpers", () => {
  it("ok wraps a value", () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
  });
  it("err wraps an error", () => {
    expect(err({ kind: "missing_price", tokenId: "usdc.near" } as const)).toEqual({
      ok: false,
      error: { kind: "missing_price", tokenId: "usdc.near" },
    });
  });
});
