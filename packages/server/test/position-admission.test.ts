import { describe, expect, it } from "vitest";
import { createPositionHandler } from "../src/position/handler";
import { config } from "./position-rpc";

const request = (id = "alice.testnet", ip = "1.2.3.4", authenticated = false) =>
  new Request(`https://app.example/api/position?accountId=${id}&networkId=testnet`, {
    headers: {
      "x-forwarded-for": ip,
      "x-edge-ip": ip,
      ...(authenticated ? { "x-edge-auth": "secret" } : {}),
    },
  });
const unavailable: typeof fetch = async () => {
  throw new Error("offline");
};
describe("position admission", () => {
  it("charges the transport before parsing and ignores spoofed forwarding", async () => {
    const handle = createPositionHandler({ config, fetchImpl: unavailable });
    for (let i = 0; i < 30; i++)
      expect(
        (
          await handle(
            new Request(`https://app.example/api/position?bad=${i}`, {
              headers: { "x-forwarded-for": `1.2.3.${i}` },
            }),
          )
        ).status,
      ).toBe(400);
    const response = await handle(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });
  it("charges network/account separately across authenticated IPs", async () => {
    const handle = createPositionHandler({
      config,
      fetchImpl: unavailable,
      proxy: { secret: "secret", secretHeader: "x-edge-auth", ipHeader: "x-edge-ip" },
    });
    for (let i = 0; i < 30; i++)
      expect((await handle(request("alice.testnet", `1.2.3.${i}`, true))).status).toBe(503);
    expect((await handle(request("alice.testnet", "2.2.2.2", true))).status).toBe(429);
    expect((await handle(request("bob.testnet", "2.2.2.3", true))).status).toBe(503);
  });
  it("refuses capacity without removing active quotas and recovers after expiry", async () => {
    let now = 0;
    const handle = createPositionHandler({
      config,
      fetchImpl: unavailable,
      now: () => now,
      rateLimit: { requests: 30, windowMs: 60000, maxEntries: 2 },
    });
    expect((await handle(request())).status).toBe(503);
    expect((await handle(request("bob.testnet"))).status).toBe(429);
    now = 60000;
    expect((await handle(request("bob.testnet"))).status).toBe(503);
  });
});
