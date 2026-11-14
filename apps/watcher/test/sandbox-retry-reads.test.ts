import { describe, expect, it, vi } from "vitest";
import { retrySandboxRead } from "../src/sandbox/retry-reads";

describe("sandbox read retries", () => {
  it("retries a transient read without retrying an explicit rejection", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("not final"));
    read.mockResolvedValueOnce(false);
    const wait = vi.fn(async () => {});
    expect(await retrySandboxRead(read, wait)).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });
  it("stops after a bounded number of failed reads and sanitizes errors", async () => {
    const read = vi.fn(async () => {
      throw new Error("secret-sentinel");
    });
    const wait = vi.fn(async () => {});
    await expect(retrySandboxRead(read, wait)).rejects.toThrow("Sandbox read unavailable");
    expect(read).toHaveBeenCalledTimes(6);
    expect(wait).toHaveBeenCalledTimes(5);
  });
});
