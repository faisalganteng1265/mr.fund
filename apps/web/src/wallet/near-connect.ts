import type { SigningWallet } from "../execution/signer";
import { validateAccounts } from "./accounts";
import type { AuthAdapter, NearNetwork, WalletConfig } from "./types";

interface AccountWallet {
  getAccounts(options: { network: NearNetwork }): Promise<unknown>;
}
type ConnectionEvent = "wallet:signIn" | "wallet:signOut";

/** Narrow SDK boundary: the adapter never exposes a wallet or signing methods. */
export interface NearConnectSDK {
  connect(): Promise<AccountWallet>;
  getConnectedWallet(): Promise<{ wallet: AccountWallet }>;
  disconnect(wallet: AccountWallet): Promise<void>;
  on(event: ConnectionEvent, changed: () => void): void;
  off(event: ConnectionEvent, changed: () => void): void;
}

/** The Connect adapter alone can reach a signing wallet; `AuthAdapter` stays signer-free. */
export interface NearConnectAdapter extends AuthAdapter {
  signingWallet(): Promise<SigningWallet>;
}

/**
 * The signing surface of the Connect adapter the wallet provider created for each network.
 * Kept here so the session controller and React context stay signer-free; only
 * `createTransactionSigner` (verified payloads only) should call it.
 */
const signingWallets = new Map<NearNetwork, () => Promise<SigningWallet>>();
export function connectSigningWallet(network: NearNetwork): (() => Promise<SigningWallet>) | null {
  return signingWallets.get(network) ?? null;
}

/**
 * The SDK appends its wallet chooser to `document.body`. While the app's modal `<dialog>` is open,
 * the browser paints the dialog above any z-index and makes everything outside it inert, so the
 * chooser is both hidden and unclickable. Move each SDK popup into the open modal dialog (the SDK
 * removes it with `root.remove()`, which still works). Returns a stop function.
 */
export function liftPopupsToTopLayer(): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const lift = (node: Node) => {
    if (!(node instanceof HTMLElement) || !node.classList.contains("hot-connector-popup")) return;
    const dialog = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].find((d) =>
      d.matches(":modal"),
    );
    if (dialog && !dialog.contains(node)) dialog.append(node);
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) lift(node);
  });
  observer.observe(document.body, { childList: true });
  return () => observer.disconnect();
}

/**
 * Meteor returns the same account once per access key (observed 2026-11-13: six copies of one
 * testnet account). Collapse repeats by account id so the strict validator still rejects
 * malformed entries and duplicates it cannot explain. Non-arrays pass through to be rejected.
 */
export function uniqueAccounts(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const seen = new Set<unknown>();
  return value.filter((entry) => {
    const id = (entry as { accountId?: unknown } | null)?.accountId;
    if (typeof id !== "string") return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function createNearConnectAdapter(
  config: WalletConfig,
  connector?: NearConnectSDK,
): NearConnectAdapter {
  const adapter = buildAdapter(config, connector);
  signingWallets.set(config.network, () => adapter.signingWallet());
  return adapter;
}

function buildAdapter(config: WalletConfig, connector?: NearConnectSDK): NearConnectAdapter {
  let loading: Promise<NearConnectSDK> | undefined;
  function getConnector(): Promise<NearConnectSDK> {
    if (connector) return Promise.resolve(connector);
    if (!loading) {
      loading = (async () => {
        if (typeof window === "undefined") throw new Error("Wallet login requires a browser.");
        // Platform-specific SDK injects DOM styles on import; defer to the browser boundary.
        const { NearConnector } = await import("@hot-labs/near-connect");
        const instance = new NearConnector({
          network: config.network,
          providers: { [config.network]: [config.rpcUrl] },
          autoConnect: false,
        });
        await instance.whenManifestLoaded;
        // SDK 0.12.0 swallows manifest fetch errors into an empty manifest.
        // With no registered wallets, that is unavailable, not a restored logout.
        if (instance.manifest.wallets.length === 0 && instance.wallets.length === 0) {
          throw new Error("Wallet providers are unavailable. Reload to try again.");
        }
        return {
          connect: () => instance.connect(),
          getConnectedWallet: () => instance.getConnectedWallet(),
          async disconnect(wallet) {
            const current = await instance.getConnectedWallet();
            if (current.wallet !== wallet) throw new Error("The connected wallet changed.");
            await instance.disconnect(current.wallet);
          },
          on: (event, changed) => instance.on(event, changed),
          off: (event, changed) => instance.off(event, changed),
        } satisfies NearConnectSDK;
      })();
    }
    return loading;
  }

  async function current(sdk: NearConnectSDK): Promise<AccountWallet | null> {
    try {
      return (await sdk.getConnectedWallet()).wallet;
    } catch (error) {
      // Exact absence messages from getConnectedWallet in the pinned SDK.
      // wallet() is deliberately unused: it masks unexpected provider errors.
      if (
        error instanceof Error &&
        (error.message === "No wallet selected" || error.message === "No accounts found")
      ) {
        return null;
      }
      throw error;
    }
  }

  return {
    method: "near-connect",
    async restore() {
      const sdk = await getConnector();
      const wallet = await current(sdk);
      if (!wallet) return [];
      // getConnectedWallet's internal read omits network; never trust its accounts.
      return validateAccounts(
        uniqueAccounts(await wallet.getAccounts({ network: config.network })),
      );
    },
    async login() {
      const sdk = await getConnector();
      const stopLifting = liftPopupsToTopLayer();
      try {
        const wallet = await sdk.connect();
        const accounts = validateAccounts(
          uniqueAccounts(await wallet.getAccounts({ network: config.network })),
        );
        if (accounts.length === 0) throw new Error("The wallet returned no connected accounts.");
        return accounts;
      } finally {
        stopLifting();
      }
    },
    async logout() {
      const sdk = await getConnector();
      const wallet = await current(sdk);
      if (wallet) await sdk.disconnect(wallet);
    },
    async signingWallet() {
      const wallet = await current(await getConnector());
      const sign = (wallet as Partial<SigningWallet> | null)?.signAndSendTransactions;
      if (!wallet || typeof sign !== "function")
        throw new Error("The connected wallet cannot sign transactions.");
      return { signAndSendTransactions: (params) => sign.call(wallet, params) };
    },
    subscribe(changed) {
      let active = true;
      let attached: NearConnectSDK | undefined;
      const notify = () => {
        if (active) changed();
      };
      void getConnector().then((sdk) => {
        if (!active) return;
        attached = sdk;
        sdk.on("wallet:signIn", notify);
        sdk.on("wallet:signOut", notify);
      }, notify);
      return () => {
        active = false;
        attached?.off("wallet:signIn", notify);
        attached?.off("wallet:signOut", notify);
      };
    },
  };
}
