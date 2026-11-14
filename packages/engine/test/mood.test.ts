import type { CardReceipt } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { MAX_DATA_AGE_MS } from "../src/health";
import { mood, OBSERVED_HEALTH_AFTER_BPS, OBSERVED_HEALTH_BEFORE_BPS } from "../src/mood";
import { baseSnapshot, NOW } from "./helpers";

// baseSnapshot health is 14250 bps.
const COMFORT = 14_000;
const confirmed = (before: string, after: string, atMs = NOW): CardReceipt => ({
  status: "confirmed",
  txHashes: ["h"],
  observed: { [OBSERVED_HEALTH_BEFORE_BPS]: before, [OBSERVED_HEALTH_AFTER_BPS]: after },
  atMs,
});

describe("mood", () => {
  it("is calm at or above the comfort line with fresh data", () => {
    expect(mood(baseSnapshot(), undefined, COMFORT, NOW)).toEqual({
      state: "calm",
      reason: "healthy",
    });
  });

  it("is calm exactly at the comfort line", () => {
    expect(mood(baseSnapshot(), undefined, 14_250, NOW).state).toBe("calm");
  });

  it("is concerned one basis point below the comfort line", () => {
    expect(mood(baseSnapshot(), undefined, 14_251, NOW)).toEqual({
      state: "concerned",
      reason: "below_comfort",
    });
  });

  it("is calm with no debt", () => {
    const s = baseSnapshot({ borrowed: [] });
    expect(mood(s, undefined, COMFORT, NOW).state).toBe("calm");
  });

  it("is concerned when data is stale, even if health is high", () => {
    const later = NOW + MAX_DATA_AGE_MS + 1;
    expect(mood(baseSnapshot(), undefined, COMFORT, later)).toEqual({
      state: "concerned",
      reason: "stale_data",
    });
    expect(mood(baseSnapshot(), undefined, COMFORT, NOW + MAX_DATA_AGE_MS).state).toBe("calm");
  });

  it("is concerned when a price is missing", () => {
    const s = baseSnapshot({ prices: {} });
    expect(mood(s, undefined, COMFORT, NOW).reason).toBe("stale_data");
  });

  it("is concerned after a failed transaction", () => {
    const r: CardReceipt = { status: "failed", txHashes: [], atMs: NOW };
    expect(mood(baseSnapshot(), r, COMFORT, NOW)).toEqual({
      state: "concerned",
      reason: "failed_transaction",
    });
  });

  it("is concerned after a partial outcome", () => {
    const r: CardReceipt = { status: "partial", txHashes: ["h"], atMs: NOW };
    expect(mood(baseSnapshot(), r, COMFORT, NOW).reason).toBe("failed_transaction");
  });

  it("is pleased after a confirmed transaction that improved health", () => {
    expect(mood(baseSnapshot(), confirmed("12000", "14250"), COMFORT, NOW)).toEqual({
      state: "pleased",
      reason: "improved_health",
    });
  });

  it("is not pleased when health did not improve", () => {
    expect(mood(baseSnapshot(), confirmed("14250", "14250"), COMFORT, NOW).state).toBe("calm");
    expect(mood(baseSnapshot(), confirmed("15000", "14250"), COMFORT, NOW).state).toBe("calm");
  });

  it("is not pleased from a receipt that is still only submitted", () => {
    const r = { ...confirmed("12000", "14250"), status: "submitted" as const };
    expect(mood(baseSnapshot(), r, COMFORT, NOW).state).toBe("calm");
  });

  it("is not pleased when the observed values are missing or malformed", () => {
    const none: CardReceipt = { status: "confirmed", txHashes: ["h"], atMs: NOW };
    expect(mood(baseSnapshot(), none, COMFORT, NOW).state).toBe("calm");
    for (const bad of ["", "abc", "-5", "1.5", "1e3"]) {
      expect(mood(baseSnapshot(), confirmed(bad, "14250"), COMFORT, NOW).state).toBe("calm");
      expect(mood(baseSnapshot(), confirmed("12000", bad), COMFORT, NOW).state).toBe("calm");
    }
  });

  it("stays concerned after an improving repay if health is still below the comfort line", () => {
    expect(mood(baseSnapshot(), confirmed("12000", "14250"), 15_000, NOW)).toEqual({
      state: "concerned",
      reason: "below_comfort",
    });
  });

  it("stale data outranks pleased and failure", () => {
    const s = baseSnapshot({ prices: {} });
    expect(mood(s, confirmed("12000", "14250"), COMFORT, NOW).state).toBe("concerned");
  });

  it("a receipt stops mattering after the window", () => {
    const old = NOW - 300_001;
    expect(mood(baseSnapshot(), confirmed("12000", "14250", old), COMFORT, NOW).state).toBe("calm");
    const failed: CardReceipt = { status: "failed", txHashes: [], atMs: old };
    expect(mood(baseSnapshot(), failed, COMFORT, NOW).state).toBe("calm");
    // exactly at the edge still counts
    expect(
      mood(baseSnapshot(), confirmed("12000", "14250", NOW - 300_000), COMFORT, NOW).state,
    ).toBe("pleased");
  });

  it("honours custom windows and data-age limits", () => {
    const r = confirmed("12000", "14250", NOW - 10_000);
    expect(mood(baseSnapshot(), r, COMFORT, NOW, { receiptWindowMs: 5_000 }).state).toBe("calm");
    const s = baseSnapshot();
    expect(mood(s, undefined, COMFORT, NOW + 1_000, { maxDataAgeMs: 500 }).reason).toBe(
      "stale_data",
    );
  });

  it("treats a receipt dated slightly in the future as current", () => {
    expect(mood(baseSnapshot(), confirmed("12000", "14250", NOW + 5_000), COMFORT, NOW).state).toBe(
      "pleased",
    );
  });

  it("rejects an invalid comfort line", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => mood(baseSnapshot(), undefined, bad, NOW)).toThrow(RangeError);
    }
  });
});
