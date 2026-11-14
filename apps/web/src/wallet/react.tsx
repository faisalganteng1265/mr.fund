"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { readWalletConfig } from "./config";
import { createWalletSession, type WalletSessionController, type WalletState } from "./session";
import type { AuthAdapter, AuthMethod, WalletConfig } from "./types";

/** Builds the adapters a config allows. Injected in tests; the default loads SDKs lazily. */
export type AdapterFactory = (
  config: WalletConfig,
) => Promise<Partial<Record<AuthMethod, AuthAdapter>>>;

export interface WalletContextValue {
  readonly controller: WalletSessionController | null;
  readonly network: WalletConfig["network"] | null;
  /** Methods the configuration enables; NEAR Auth is absent without an approved client id. */
  readonly available: readonly AuthMethod[];
  /** Set when public configuration is missing or inconsistent; real login is blocked. */
  readonly configError: string | null;
}

const CHECKING: WalletState = Object.freeze({ status: "checking", session: null, error: null });
const NO_PROVIDER: WalletContextValue = {
  controller: null,
  network: null,
  available: [],
  configError: null,
};
const WalletContext = createContext<WalletContextValue>(NO_PROVIDER);

/** SDK modules are imported only here, in the browser, after the provider mounts. */
export const loadAdapters: AdapterFactory = async (config) => {
  const adapters: Partial<Record<AuthMethod, AuthAdapter>> = {};
  const [{ createNearConnectAdapter }, auth] = await Promise.all([
    import("./near-connect"),
    config.auth ? import("./near-auth") : null,
  ]);
  adapters["near-connect"] = createNearConnectAdapter(config);
  if (auth) adapters["near-auth"] = auth.createNearAuthAdapter(config);
  return adapters;
};

const publicEnv = () => ({
  network: process.env.NEXT_PUBLIC_NEAR_NETWORK_ID,
  rpcUrl: process.env.NEXT_PUBLIC_NEAR_RPC_URL,
  authClientId: process.env.NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID,
});

const browserStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/**
 * Route-scoped wallet context for `/play` (narrows add-dual-near-auth task 3.3 from the root
 * layout so the landing bundle never loads wallet SDKs). Server render and first paint are
 * `checking`; restoration is passive and never opens a prompt. No signer is exposed.
 */
export function WalletProvider({
  children,
  env = publicEnv,
  adapters = loadAdapters,
}: {
  children?: ReactNode;
  env?: () => Parameters<typeof readWalletConfig>[0];
  adapters?: AdapterFactory;
}) {
  const [value, setValue] = useState<WalletContextValue>(NO_PROVIDER);
  useEffect(() => {
    let cancelled = false;
    let controller: WalletSessionController | null = null;
    let config: WalletConfig;
    try {
      config = readWalletConfig(env());
    } catch (error) {
      setValue({
        ...NO_PROVIDER,
        configError: error instanceof Error ? error.message : "Wallet configuration is invalid.",
      });
      return;
    }
    adapters(config)
      .then((built) => {
        if (cancelled) return;
        controller = createWalletSession(config.network, built, browserStorage());
        setValue({
          controller,
          network: config.network,
          available: (["near-auth", "near-connect"] as const).filter((m) => built[m]),
          configError: null,
        });
        controller.restore().catch(() => {});
      })
      .catch(() => {
        if (!cancelled)
          setValue({
            ...NO_PROVIDER,
            network: config.network,
            configError: "Wallet providers could not load. Reload to try again.",
          });
      });
    return () => {
      cancelled = true;
      controller?.dispose();
    };
  }, [env, adapters]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

const noop = () => () => {};

/** Controller state plus guarded actions. Repeated activation while busy is ignored. */
export function useWalletSession() {
  const context = useContext(WalletContext);
  const { controller } = context;
  const configState: WalletState | null = context.configError
    ? Object.freeze({ status: "error", session: null, error: context.configError })
    : null;
  const live = useSyncExternalStore(
    controller?.subscribe ?? noop,
    () => controller?.getSnapshot() ?? CHECKING,
    () => CHECKING,
  );
  const state = configState ?? live;
  const busy = state.status === "connecting" || state.status === "signing-out";
  const login = useCallback(
    async (method: AuthMethod) => {
      if (!controller || !context.available.includes(method)) return;
      const now = controller.getSnapshot().status;
      if (now === "connecting" || now === "signing-out") return;
      await controller.login(method).catch(() => {});
    },
    [controller, context.available],
  );
  const logout = useCallback(async () => {
    if (!controller) return;
    const now = controller.getSnapshot().status;
    if (now === "connecting" || now === "signing-out") return;
    await controller.logout().catch(() => {});
  }, [controller]);
  const selectAccount = useCallback(
    (accountId: string) => {
      try {
        controller?.selectAccount(accountId);
      } catch {
        // Only accounts in the current provider session are selectable; ignore anything else.
      }
    },
    [controller],
  );
  return {
    ...context,
    state,
    busy,
    login,
    logout,
    selectAccount,
  };
}

export type WalletSession = ReturnType<typeof useWalletSession>;
