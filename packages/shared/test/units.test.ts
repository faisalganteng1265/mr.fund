import { describe, expect, it } from "vitest";
import {
  decimalString,
  formatUnits,
  parseAtomic,
  toAtomic,
  toInternal,
  usdPerWholeToken,
} from "../src/index";

describe("toInternal / toAtomic", () => {
  it("round-trips for extraDecimals 0 and 12", () => {
    for (const ed of [0, 12]) {
      const atomic = 123_456_789n;
      expect(toAtomic(toInternal(atomic, ed), ed)).toBe(atomic);
    }
  });

  it("toInternal scales by 10^extraDecimals", () => {
    expect(toInternal(5n, 12)).toBe(5_000_000_000_000n);
    expect(toInternal(5n, 0)).toBe(5n);
  });

  it("toAtomic floors the remainder", () => {
    expect(toAtomic(1_999_999_999_999n, 12)).toBe(1n);
    expect(toAtomic(999_999_999_999n, 12)).toBe(0n);
  });

  it("keeps values beyond 2^64", () => {
    const big = 2n ** 64n + 7n;
    expect(toAtomic(toInternal(big, 12), 12)).toBe(big);
  });

  it("rejects negative amounts and invalid decimals", () => {
    expect(() => toInternal(-1n, 0)).toThrow(RangeError);
    expect(() => toAtomic(-1n, 0)).toThrow(RangeError);
    expect(() => toInternal(1n, -1)).toThrow(RangeError);
    expect(() => toInternal(1n, 1.5)).toThrow(RangeError);
  });
});

describe("parseAtomic", () => {
  it("accepts canonical non-negative integers", () => {
    expect(parseAtomic("0")).toEqual({ ok: true, value: 0n });
    expect(parseAtomic("100")).toEqual({ ok: true, value: 100n });
  });

  it("keeps values beyond 2^64", () => {
    expect(parseAtomic("18446744073709551616")).toEqual({ ok: true, value: 2n ** 64n });
  });

  it.each(["", "-5", "1.5", "1e6", " 100", "100 ", "007", "abc", "+5", "0x10"])(
    "rejects %j with invalid_amount",
    (input) => {
      const r = parseAtomic(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("invalid_amount");
    },
  );
});

describe("formatUnits (display only)", () => {
  it("formats with the locale's separators", () => {
    expect(formatUnits(1_234_500_000n, 6, "id-ID")).toBe("1.234,5");
    expect(formatUnits(1_234_500_000n, 6, "en-US")).toBe("1,234.5");
    expect(formatUnits(12_345_500_000n, 6, "es-ES")).toBe("12.345,5");
  });

  it("drops trailing zeros and the separator for whole amounts", () => {
    expect(formatUnits(2_000_000n, 6, "en-US")).toBe("2");
    expect(formatUnits(0n, 6, "en-US")).toBe("0");
  });

  it("keeps leading fractional zeros", () => {
    expect(formatUnits(1_050n, 6, "en-US")).toBe("0.00105");
  });

  it("handles decimals 0 and amounts beyond 2^64 without losing digits", () => {
    expect(formatUnits(42n, 0, "en-US")).toBe("42");
    expect(formatUnits(2n ** 64n, 0, "en-US")).toBe("18,446,744,073,709,551,616");
  });
});

describe("decimalString", () => {
  it("is exact and drops trailing zeros", () => {
    expect(decimalString(1_234_567_890n, 6)).toBe("1234.56789");
    expect(decimalString(5n, 6)).toBe("0.000005");
    expect(decimalString(200_000_000n, 6)).toBe("200");
    expect(decimalString(0n, 6)).toBe("0");
    expect(decimalString(7n, 0)).toBe("7");
    expect(decimalString(2n ** 127n, 18)).toBe("170141183460469231731.687303715884105728");
  });

  it("rejects negatives and bad decimals", () => {
    expect(() => decimalString(-1n, 6)).toThrow(RangeError);
    expect(() => decimalString(1n, -1)).toThrow(RangeError);
    expect(() => decimalString(1n, 1.5)).toThrow(RangeError);
    expect(() => decimalString(1n, 78)).toThrow(RangeError);
  });
});

describe("usdPerWholeToken", () => {
  const price = (multiplier: bigint, decimals: number) => ({
    multiplier,
    decimals,
    publishTimeMs: 0,
    source: "oracle" as const,
  });

  it("converts when the price has more decimals than the token", () => {
    expect(usdPerWholeToken(price(50_000n, 28), 24)).toBe("5");
    expect(usdPerWholeToken(price(10_000n, 10), 6)).toBe("1");
  });

  it("converts when the price has fewer decimals than the token", () => {
    expect(usdPerWholeToken(price(3n, 2), 6)).toBe("30000");
  });
});
