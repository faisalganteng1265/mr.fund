import { describe, expect, it } from "vitest";
import { createAdmission, edgeIp, readProxyConfig } from "../src/admission";

describe("bounded local-process read admission", () => {
  it("retains active quotas at capacity and evicts only expired buckets", () => {
    let now = 0;
    const allow = createAdmission({ requests: 2, windowMs: 60000, maxEntries: 2 }, () => now);
    expect(allow(["ip:a"])).toBe(true);
    expect(allow(["account:a"])).toBe(true);
    expect(allow(["ip:b"])).toBe(false);
    expect(allow(["ip:a"])).toBe(true);
    expect(allow(["ip:a"])).toBe(false);
    now = 60000;
    expect(allow(["ip:b", "account:b"])).toBe(true);
  });
  it("trusts only the authenticated edge's overwritten IP header", () => {
    const proxy = { secret: "edge-secret", secretHeader: "x-edge-auth", ipHeader: "x-edge-ip" };
    expect(
      edgeIp(
        new Request("https://app.example", {
          headers: { "x-forwarded-for": "1.2.3.4", "x-edge-ip": "1.2.3.4" },
        }),
        proxy,
      ),
    ).toBe("direct-client");
    expect(
      edgeIp(
        new Request("https://app.example", {
          headers: { "x-edge-auth": "edge-secret", "x-edge-ip": "1.2.3.4" },
        }),
        proxy,
      ),
    ).toBe("1.2.3.4");
    expect(
      edgeIp(
        new Request("https://app.example", {
          headers: { "x-edge-auth": "edge-secret", "x-edge-ip": "not-an-ip" },
        }),
        proxy,
      ),
    ).toBe("direct-client");
    expect(
      readProxyConfig({
        CHAT_PROXY_SECRET: "secret",
        CHAT_PROXY_SECRET_HEADER: "same",
        CHAT_PROXY_IP_HEADER: "SAME",
      }),
    ).toBeUndefined();
  });
});
