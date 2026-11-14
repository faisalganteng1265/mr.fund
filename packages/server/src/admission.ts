import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export interface ProxyConfig {
  secret: string;
  secretHeader: string;
  ipHeader: string;
}
export interface RateLimit {
  requests: number;
  windowMs: number;
  maxEntries: number;
}
export function edgeIp(request: Request, proxy: ProxyConfig | undefined): string {
  if (proxy?.secret) {
    const supplied = new TextEncoder().encode(request.headers.get(proxy.secretHeader) ?? "");
    const expected = new TextEncoder().encode(proxy.secret);
    const ip = request.headers.get(proxy.ipHeader) ?? "";
    if (
      supplied.byteLength === expected.byteLength &&
      timingSafeEqual(supplied, expected) &&
      isIP(ip)
    )
      return ip;
  }
  // Next's Web Request has no authoritative peer address. Never trust x-forwarded-for by default.
  return "direct-client";
}

export function createAdmission(limit: RateLimit, clock: () => number = Date.now) {
  const buckets = new Map<string, { used: number; expires: number }>();
  if (
    !Number.isSafeInteger(limit.requests) ||
    limit.requests < 1 ||
    !Number.isSafeInteger(limit.windowMs) ||
    limit.windowMs < 1 ||
    !Number.isSafeInteger(limit.maxEntries) ||
    limit.maxEntries < 2
  )
    throw new Error("Invalid rate configuration");
  return (keys: string[]): boolean => {
    const now = clock();
    for (const [key, bucket] of buckets) if (bucket.expires <= now) buckets.delete(key);
    const missing = keys.filter((key) => !buckets.has(key)).length;
    if (
      buckets.size + missing > limit.maxEntries ||
      keys.some((key) => (buckets.get(key)?.used ?? 0) >= limit.requests)
    )
      return false;
    for (const key of keys) {
      const bucket = buckets.get(key) ?? { used: 0, expires: now + limit.windowMs };
      bucket.used++;
      buckets.set(key, bucket);
    }
    return true;
  };
}

/** Same edge contract as chat; missing/invalid configuration conservatively groups direct clients. */
export function readProxyConfig(
  env: Readonly<Record<string, string | undefined>>,
): ProxyConfig | undefined {
  const secret = env.CHAT_PROXY_SECRET;
  const secretHeader = env.CHAT_PROXY_SECRET_HEADER;
  const ipHeader = env.CHAT_PROXY_IP_HEADER;
  const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
  return secret &&
    secretHeader &&
    ipHeader &&
    headerName.test(secretHeader) &&
    headerName.test(ipHeader) &&
    secretHeader.toLowerCase() !== ipHeader.toLowerCase()
    ? { secret, secretHeader, ipHeader }
    : undefined;
}
