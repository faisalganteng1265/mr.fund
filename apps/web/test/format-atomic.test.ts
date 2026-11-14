import { describe, expect, it } from "vitest";
import { formatAtomic } from "../src/play/source/formatAtomic";

describe("formatAtomic", () => {
  it("formats exact token amounts without floating point", () => {
    expect(formatAtomic(0n, 6)).toBe("0");
    expect(formatAtomic("1234567", 6)).toBe("1.234567");
    expect(formatAtomic("1", 24)).toBe("0.000000000000000000000001");
    expect(formatAtomic("123456789012345678901234567890", 6)).toBe(
      "123456789012345678901234.56789",
    );
    expect(formatAtomic("1000000", 6)).toBe("1");
  });
  it("rejects malformed values and decimals", () => {
    for (const value of ["-1", "1.2", "01", ""]) expect(() => formatAtomic(value, 6)).toThrow();
    expect(() => formatAtomic("1", 39)).toThrow();
  });
  it("round trips a range of atomic values exactly", () => {
    for (let decimals = 0; decimals <= 24; decimals++) {
      for (let n = 0n; n < 100n; n++) {
        const value = n * 987654321987654321n;
        const [whole, fraction = ""] = formatAtomic(value, decimals).split(".");
        expect(BigInt(`${whole}${fraction.padEnd(decimals, "0")}`)).toBe(value);
      }
    }
  });
});
