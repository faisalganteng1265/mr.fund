import { describe, expect, it, vi } from "vitest";
import { createLivePosition } from "../src/play/source/livePosition";

const result = (value: unknown, status = 200) => Response.json(value, { status });
const valid = {
  ok: true,
  accountId: "alice.testnet",
  networkId: "testnet",
  dataAgeMs: 10,
  maxDataAgeMs: 100,
  provenance: "live",
  supplied: [],
  collateral: [],
  debt: [],
  liquidationPrices: [],
  health: { kind: "no_debt" },
};

describe("live position reads", () => {
  it("reads only on explicit refresh and rejects wrong network and account", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(result(valid))
      .mockResolvedValueOnce(result({ ...valid, networkId: "mainnet" }))
      .mockResolvedValueOnce(result({ ...valid, accountId: "bob.testnet" }));
    const port = createLivePosition("alice.testnet", "testnet", fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    await port.refresh();
    expect(port.getSnapshot().status).toBe("ready");
    await port.refresh();
    expect(port.getSnapshot().status).toBe("network_mismatch");
    await port.refresh();
    expect(port.getSnapshot().status).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([
    ["no_position", "empty"],
    ["stale_data", "stale"],
    ["rpc_unavailable", "unavailable"],
    ["network_mismatch", "network_mismatch"],
  ])("maps %s", async (code, status) => {
    const port = createLivePosition("alice.testnet", "testnet", async () =>
      result({ ok: false, networkId: "testnet", error: { code } }, 422),
    );
    await port.refresh();
    expect(port.getSnapshot().status).toBe(status);
  });
  it("prevents a superseded response from replacing the newest", async () => {
    let resolve!: (value: Response) => void;
    const first = new Promise<Response>((r) => {
      resolve = r;
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(result(valid));
    const port = createLivePosition("alice.testnet", "testnet", fetcher);
    const old = port.refresh();
    await port.refresh();
    resolve(result({ ...valid, networkId: "mainnet" }));
    await old;
    expect(port.getSnapshot().status).toBe("ready");
  });
  it("does not expose an already stale successful response", async () => {
    const port = createLivePosition("alice.testnet", "testnet", async () =>
      result({ ...valid, dataAgeMs: 101 }),
    );
    await port.refresh();
    expect(port.getSnapshot()).toEqual({ status: "stale" });
  });
  it("expires data without making another request", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(result(valid));
      const port = createLivePosition("alice.testnet", "testnet", fetcher);
      await port.refresh();
      expect(port.getSnapshot().status).toBe("ready");
      await vi.advanceTimersByTimeAsync(91);
      expect(port.getSnapshot().status).toBe("stale");
      expect(fetcher).toHaveBeenCalledOnce();
      port.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it("propagates caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const port = createLivePosition("alice.testnet", "testnet");
    await expect(port.refresh(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
