import { createRheaClient } from "@mrfund/rhea";
import { base58 } from "@scure/base";
import type { ConnectedAccount, WalletConfig } from "./types";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Public address derivation only: does not create an account or establish funding. */
export async function resolveAuthAccount(
  config: WalletConfig,
  subject: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectedAccount> {
  const auth = config.auth;
  if (!auth) throw new Error("NEAR Auth is not configured");
  if (
    typeof subject !== "string" ||
    subject.length < 1 ||
    subject.length > 256 ||
    /[#\p{Cc}]/u.test(subject)
  )
    throw new Error("Invalid NEAR Auth identity");

  // The existing view client is browser-compatible but its JSON read is unbounded.
  // Bound both status and view HTTP/body reads with one deadline and byte ceiling.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("NEAR Auth RPC timed out"));
    }, 10_000);
  });
  const boundedFetch: typeof fetch = async (url, init) => {
    const response = await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal, credentials: "omit" }),
      deadline,
    ]);
    if (!response.ok || !response.body) throw new Error("NEAR Auth RPC unavailable");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await Promise.race([reader.read(), deadline]);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 65_536) throw new Error("NEAR Auth RPC response too large");
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return new Response(text);
    } finally {
      // A stalled or malicious stream cannot delay the deadline during cleanup.
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };
  try {
    const status: unknown = await (
      await boundedFetch(config.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "auth-status", method: "status", params: [] }),
      })
    ).json();
    if (
      !object(status) ||
      status.error !== undefined ||
      !object(status.result) ||
      status.result.chain_id !== config.network
    )
      throw new Error("NEAR Auth RPC chain mismatch");

    const result = await createRheaClient(config.rpcUrl, boundedFetch).view(
      auth.mpcId,
      "derived_public_key",
      {
        path: `jwt#https://${auth.domain}/#${subject}`,
        predecessor: auth.contractId,
        domain_id: 1,
      },
    );
    if (!result.ok) throw new Error("NEAR Auth public key unavailable");
    const publicKey = result.value.data;
    if (typeof publicKey !== "string" || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(publicKey))
      throw new Error("Invalid NEAR Auth public key");
    const encoded = publicKey.slice("ed25519:".length);
    const bytes = base58.decode(encoded);
    if (bytes.length !== 32 || base58.encode(bytes) !== encoded)
      throw new Error("Invalid NEAR Auth public key");
    return {
      accountId: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      publicKey,
    };
  } catch {
    // RPC/provider errors may contain identity paths; never forward those details.
    throw new Error("NEAR Auth account resolution failed");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
