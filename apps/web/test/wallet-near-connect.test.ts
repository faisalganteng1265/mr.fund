import { afterEach, describe, expect, it, vi } from "vitest";
import { createNearConnectAdapter } from "../src/wallet/near-connect";
import type { WalletConfig } from "../src/wallet/types";

const sdk = vi.hoisted(() => ({ construct: vi.fn() }));
vi.mock("@hot-labs/near-connect", () => ({ NearConnector: sdk.construct }));
const config: WalletConfig = {
  network: "testnet",
  rpcUrl: "https://rpc.example",
  auth: null,
};

// Stateful synthetic provider: no real wallet, keys, accounts or network requests.
function provider(initial: unknown = [{ accountId: "alice.testnet" }]) {
  let selected = false;
  let accounts = initial;
  let failure: Error | undefined;
  let prompts = 0;
  const listeners = new Map<string, Set<() => void>>();
  const wallet = {
    async getAccounts(options?: { network: string }) {
      if (failure) throw failure;
      if (options && options.network !== "testnet") throw new Error("Wrong network");
      return options ? accounts : [{ accountId: "default-network.near" }];
    },
  };
  const connector = {
    async connect() {
      prompts++;
      selected = true;
      return wallet;
    },
    async getConnectedWallet() {
      if (failure) throw failure;
      if (!selected) throw new Error("No wallet selected");
      if (Array.isArray(accounts) && accounts.length === 0) throw new Error("No accounts found");
      return { wallet, accounts: await wallet.getAccounts() };
    },
    async disconnect(current: typeof wallet) {
      if (current !== wallet) throw new Error("Must disconnect current wallet");
      if (failure) throw failure;
      selected = false;
      accounts = [];
    },
    on(event: string, changed: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(changed);
    },
    off(event: string, changed: () => void) {
      listeners.get(event)?.delete(changed);
    },
  };
  return {
    connector,
    select: () => {
      selected = true;
    },
    fail: (error: Error) => {
      failure = error;
    },
    replace: (value: unknown) => {
      accounts = value;
    },
    prompts: () => prompts,
    emit: (event: string) => {
      for (const changed of listeners.get(event) ?? []) changed();
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  sdk.construct.mockReset();
});

describe("NEAR Connect browser account context", () => {
  it("retains multiple accounts but never SDK signing capabilities or extra data", async () => {
    const p = provider([
      { accountId: "alice.testnet", signMessage: () => "forbidden" },
      { accountId: "bob.testnet", profile: "private" },
    ]);
    const adapter = createNearConnectAdapter(config, p.connector);
    expect(await adapter.login()).toEqual([
      { accountId: "alice.testnet" },
      { accountId: "bob.testnet" },
    ]);
    expect(await adapter.restore()).toEqual([
      { accountId: "alice.testnet" },
      { accountId: "bob.testnet" },
    ]);
  });

  it("collapses the same account returned once per access key (Meteor sent six copies)", async () => {
    const copies = Array.from({ length: 6 }, () => ({ accountId: "my-dev.testnet" }));
    const adapter = createNearConnectAdapter(config, provider(copies).connector);
    expect(await adapter.login()).toEqual([{ accountId: "my-dev.testnet" }]);
    expect(await adapter.restore()).toEqual([{ accountId: "my-dev.testnet" }]);
  });

  it("still rejects a repeated id when another entry is malformed", async () => {
    const adapter = createNearConnectAdapter(
      config,
      provider([{ accountId: "alice.testnet" }, { accountId: "alice.testnet" }, null]).connector,
    );
    await expect(adapter.login()).rejects.toThrow();
  });

  it.each(
    [
      null,
      [{ accountId: "Invalid account" }],
      [{ accountId: "alice.testnet", publicKey: 7 }],
      Array.from({ length: 21 }, (_, i) => ({ accountId: `user${i}.testnet` })),
    ].map((accounts) => ({ accounts })),
  )("rejects malformed provider accounts: $accounts", async ({ accounts }) => {
    const p = provider(accounts);
    const adapter = createNearConnectAdapter(config, p.connector);
    await expect(adapter.login()).rejects.toThrow();
    p.select();
    await expect(adapter.restore()).rejects.toThrow();
  });

  it("rejects successful connect with no accounts instead of inventing login", async () => {
    await expect(
      createNearConnectAdapter(config, provider([]).connector).login(),
    ).rejects.toThrow();
  });

  it("restores passively on the configured network without a connection prompt", async () => {
    const p = provider();
    p.select();
    expect(await createNearConnectAdapter(config, p.connector).restore()).toEqual([
      { accountId: "alice.testnet" },
    ]);
    expect(p.prompts()).toBe(0);
  });

  it.each(["No wallet selected", "No accounts found"])(
    "recognizes SDK absence: %s",
    async (message) => {
      const p = provider(message === "No accounts found" ? [] : undefined);
      if (message === "No accounts found") p.select();
      expect(await createNearConnectAdapter(config, p.connector).restore()).toEqual([]);
      expect(p.prompts()).toBe(0);
    },
  );

  it.each(["RPC unavailable", "Failed to load manifest", "Wallet not found"])(
    "surfaces unexpected restore failure: %s",
    async (message) => {
      const p = provider();
      p.fail(new Error(message));
      await expect(createNearConnectAdapter(config, p.connector).restore()).rejects.toThrow();
    },
  );

  it("disconnects the actual current wallet and leaves no restored account", async () => {
    const p = provider();
    const adapter = createNearConnectAdapter(config, p.connector);
    await adapter.login();
    await adapter.logout();
    expect(await adapter.restore()).toEqual([]);
    expect(p.prompts()).toBe(1);
  });

  it("propagates sign-out failure without pretending the provider disconnected", async () => {
    const p = provider();
    const adapter = createNearConnectAdapter(config, p.connector);
    await adapter.login();
    p.fail(new Error("Provider rejected logout"));
    await expect(adapter.logout()).rejects.toThrow();
  });

  it("signals account rechecks, ignores event identity and detaches both event listeners", async () => {
    const p = provider();
    const adapter = createNearConnectAdapter(config, p.connector);
    await adapter.login();
    const observations: unknown[] = [];
    const unsubscribe = adapter.subscribe?.(() => {
      observations.push("recheck");
    });
    await Promise.resolve();
    p.replace([{ accountId: "bob.testnet" }]);
    p.emit("wallet:signIn");
    expect(observations).toEqual(["recheck"]);
    expect(await adapter.restore()).toEqual([{ accountId: "bob.testnet" }]);
    p.emit("wallet:signOut");
    expect(observations).toHaveLength(2);
    unsubscribe?.();
    p.emit("wallet:signIn");
    p.emit("wallet:signOut");
    expect(observations).toHaveLength(2);
  });

  it("does not convert the SDK's swallowed empty-manifest initialization failure to logout", async () => {
    vi.stubGlobal("window", {});
    let wallets: object[] = [];
    sdk.construct.mockImplementation(function (this: object) {
      Object.assign(this, {
        ...provider().connector,
        whenManifestLoaded: Promise.resolve(),
        manifest: { wallets },
        wallets: [],
      });
    });
    await expect(createNearConnectAdapter(config).restore()).rejects.toThrow();
    wallets = [{}];
    await expect(createNearConnectAdapter(config).restore()).resolves.toEqual([]);
  });
});
