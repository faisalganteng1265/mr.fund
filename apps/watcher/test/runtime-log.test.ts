import { baseEncode } from "near-api-js";
import { describe, expect, it } from "vitest";
import { createRuntimeLog } from "../src/runtime/log";

describe("watcher runtime logging", () => {
  it("retains freshness and pending/error flags without copying raw error or hash data", () => {
    const lines: string[] = [];
    const log = createRuntimeLog((line) => lines.push(line));
    log.event({
      event: "request_failed",
      guardianId: "guardian.testnet",
      at: 100,
      hash: "SECRET_HASH",
      detail: "SECRET_RPC",
    });
    log.heartbeat({
      observedAt: 120,
      startedAt: 1,
      intervalMs: 30,
      guardians: [
        {
          guardianId: "guardian.testnet",
          network: "testnet",
          requests: "read_only",
          readOnlyReason: "SECRET_REASON",
          monitoring: "stale_observation",
          lastSuccessfulReadAt: 50,
          lastEvaluationAt: 60,
          lastDecision: "SECRET_DECISION",
          pendingHash: "SECRET_HASH",
          consecutiveReadFailures: 2,
          retryAt: 150,
          lastError: "SECRET_RPC",
        },
      ],
    });
    expect(lines.join(" ")).not.toContain("SECRET");
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      event: "request_failed",
      guardianId: "guardian.testnet",
      at: 100,
    });
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({
      event: "heartbeat",
      observedAt: 120,
      guardians: [
        {
          monitoring: "stale_observation",
          lastSuccessfulReadAt: 50,
          lastEvaluationAt: 60,
          pending: true,
          hasError: true,
          retryAt: 150,
        },
      ],
    });
  });
  it("retains a valid public transaction hash for operator reconciliation", () => {
    const lines: string[] = [];
    const hash = baseEncode(new Uint8Array(32).fill(2));
    createRuntimeLog((line) => lines.push(line)).event({
      event: "request_pending",
      guardianId: "guardian.testnet",
      at: 1,
      hash,
    });
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ event: "request_pending", hash });
  });
});
