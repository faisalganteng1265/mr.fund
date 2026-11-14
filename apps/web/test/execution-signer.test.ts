import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repayPayload } from "@mrfund/rhea";
import type { Card } from "@mrfund/shared";
import { describe, expect, it, vi } from "vitest";
import { createTransactionSigner, type SigningWallet } from "../src/execution/signer";
import { type VerifiedRepay, verifyCardPayload } from "../src/execution/verify";
import {
  connectSigningWallet,
  createNearConnectAdapter,
  type NearConnectSDK,
} from "../src/wallet/near-connect";

const TOKEN = { id: "usdc.testnet", symbol: "USDC", decimals: 6, extraDecimals: 12 };
const LENDING = "rhea.testnet";

function verified(accountId = "alice.testnet", network: "testnet" | "mainnet" = "testnet") {
  const payload = repayPayload(
    {
      action: "repay",
      headline: "Repay 1 USDC",
      numbers: [],
      assumptions: [],
      fees: [],
      risks: [],
      dataAgeMs: 0,
      maxDataAgeMs: 1,
      amount: 1_000_000n,
      tokenId: TOKEN.id,
      cappedBy: null,
    },
    { lendingId: LENDING, lendingVersion: "0.16.2", extraDecimals: 12, recipientRegistered: true },
  );
  if (!payload.ok) throw new Error("fixture");
  const card: Card = {
    id: "c",
    action: "repay",
    headline: "Repay 1 USDC",
    reason: "",
    numbers: [],
    assumptions: [],
    fees: [],
    risks: [],
    dataAgeMs: 0,
    maxDataAgeMs: 1,
    payload: payload.value,
  };
  const r = verifyCardPayload(card, {
    network,
    session: { network, accountId },
    signerId: accountId,
    lendingId: LENDING,
    feeRecipientId: "fees.testnet",
    lendingVersion: "0.16.2",
    token: TOKEN,
  });
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

function wallet(result: unknown = [{ transaction: { hash: "h" } }]) {
  const sign = vi.fn(async () => result);
  return { sign, get: async (): Promise<SigningWallet> => ({ signAndSendTransactions: sign }) };
}
const connect = {
  method: "near-connect" as const,
  accountId: "alice.testnet",
  network: "testnet" as const,
};

describe("TransactionSigner", () => {
  it("does not exist for NEAR Auth sessions", () => {
    expect(createTransactionSigner({ ...connect, method: "near-auth" }, wallet().get)).toBeNull();
  });

  it("signs a verified payload as the session account on its network, result unmodified", async () => {
    const result = [{ transaction: { hash: "h" } }, { extra: true }];
    const w = wallet(result);
    const signer = createTransactionSigner(connect, w.get);
    expect(await signer?.signAndSend(verified())).toBe(result);
    expect(w.sign).toHaveBeenCalledWith({
      network: "testnet",
      signerId: "alice.testnet",
      transactions: [
        {
          receiverId: TOKEN.id,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: "ft_transfer_call",
                args: { receiver_id: LENDING, amount: "1000000", msg: '"OnlyRepay"' },
                gas: "100000000000000",
                deposit: "1",
              },
            },
          ],
        },
      ],
    });
  });

  it("refuses unverified, foreign-account and wrong-network payloads before the wallet", async () => {
    const w = wallet();
    const signer = createTransactionSigner(connect, w.get);
    const forged = { ...verified() } as VerifiedRepay;
    await expect(signer?.signAndSend(forged)).rejects.toThrow(/verified payload/);
    await expect(signer?.signAndSend(verified("bob.testnet"))).rejects.toThrow(/another account/);
    await expect(signer?.signAndSend(verified("alice.testnet", "mainnet"))).rejects.toThrow(
      /another network/,
    );
    expect(w.sign).not.toHaveBeenCalled();
  });

  it("verified results cannot be mutated into another payload", () => {
    const v = verified();
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.transactions[0])).toBe(true);
  });
});

describe("NEAR Connect adapter signing wallet", () => {
  function sdk(wallet: unknown): NearConnectSDK {
    return {
      connect: async () => wallet as never,
      getConnectedWallet: async () => ({ wallet: wallet as never }),
      disconnect: async () => {},
      on: () => {},
      off: () => {},
    };
  }
  const config = {
    network: "testnet" as const,
    rpcUrl: "https://rpc.testnet.near.org/",
    auth: null,
  };

  it("passes calls to the connected wallet", async () => {
    const sign = vi.fn(async () => ["ok"]);
    const adapter = createNearConnectAdapter(
      config,
      sdk({ getAccounts: async () => [], signAndSendTransactions: sign }),
    );
    const w = await adapter.signingWallet();
    await w.signAndSendTransactions({
      network: "testnet",
      signerId: "a.testnet",
      transactions: [],
    });
    expect(sign).toHaveBeenCalledOnce();
  });

  it("exposes the latest adapter's signing surface per network only", async () => {
    expect(connectSigningWallet("mainnet")).toBeNull();
    const sign = vi.fn(async () => ["ok"]);
    createNearConnectAdapter(
      config,
      sdk({ getAccounts: async () => [], signAndSendTransactions: sign }),
    );
    const get = connectSigningWallet("testnet");
    if (!get) throw new Error("missing");
    await (await get()).signAndSendTransactions({
      network: "testnet",
      signerId: "a.testnet",
      transactions: [],
    });
    expect(sign).toHaveBeenCalledOnce();
    expect(connectSigningWallet("mainnet")).toBeNull();
  });

  it("refuses a wallet without transaction signing", async () => {
    const adapter = createNearConnectAdapter(config, sdk({ getAccounts: async () => [] }));
    await expect(adapter.signingWallet()).rejects.toThrow(/cannot sign/);
  });

  it("keeps the session controller and NEAR Auth adapter signer-free", () => {
    const src = join(__dirname, "../src/wallet");
    for (const file of ["session.ts", "near-auth.ts", "types.ts", "react.tsx"])
      expect(readFileSync(join(src, file), "utf8")).not.toMatch(
        /signAndSend|signingWallet|TransactionSigner/,
      );
  });
});

describe("browser outcome reading (task 1.4)", () => {
  it("rhea and shared import no Node-only module", () => {
    const root = join(__dirname, "../../../packages");
    for (const pkg of ["rhea", "shared"]) {
      const dir = join(root, pkg, "src");
      const files = readdirSync(dir, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith(".ts"));
      for (const f of files) {
        const text = readFileSync(join(dir, f), "utf8");
        expect(text).not.toMatch(/from "node:|require\(|\bBuffer\b|process\./);
        for (const m of text.matchAll(/from "([^"]+)"/g))
          expect(m[1]?.startsWith(".") || m[1] === "@mrfund/shared").toBe(true);
      }
    }
  });
});
