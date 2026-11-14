import { validateAccounts } from "./accounts";
import type { AuthAdapter, AuthMethod, ConnectedAccount, NearNetwork } from "./types";

export interface ActiveSession {
  readonly method: AuthMethod;
  readonly network: NearNetwork;
  readonly accountId: string;
  readonly accounts: readonly ConnectedAccount[];
  readonly contextKey: string;
}
export interface WalletState {
  readonly status:
    | "checking"
    | "disconnected"
    | "connecting"
    | "connected"
    | "signing-out"
    | "error";
  readonly session: ActiveSession | null;
  readonly error: string | null;
}
export interface WalletSessionController {
  getSnapshot(): WalletState;
  subscribe(listener: () => void): () => void;
  restore(): Promise<void>;
  login(method: AuthMethod): Promise<void>;
  selectAccount(accountId: string): void;
  logout(): Promise<void>;
  dispose(): void;
}
type HintStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Adapters = Partial<Record<AuthMethod, AuthAdapter>>;

/** Provider state is authority; browser storage is only a network-scoped preference. */
export function createWalletSession(
  network: NearNetwork,
  adapters: Adapters,
  storage?: HintStorage,
): WalletSessionController {
  const key = `mrfund:wallet:v1:${network}`;
  const listeners = new Set<() => void>();
  let state: WalletState = Object.freeze({ status: "checking", session: null, error: null });
  let generation = 0;
  let disposed = false;
  let active: AuthMethod | null = null;
  let selected: string | undefined;
  let detach: (() => void) | undefined;
  function requireIdle() {
    if (state.status === "connecting" || state.status === "signing-out")
      throw new Error("Wait for the current provider operation to finish, then try again.");
  }
  function publish(next: WalletState) {
    if (disposed) return;
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  }
  function save(method?: AuthMethod, accountId?: string) {
    try {
      if (method && accountId) storage?.setItem(key, JSON.stringify({ method, accountId }));
      else storage?.removeItem(key);
    } catch {
      /* Storage is optional, never authentication. */
    }
  }
  function clear() {
    detach?.();
    detach = undefined;
    active = null;
    selected = undefined;
    save();
  }
  function watch(method: AuthMethod) {
    detach?.();
    active = method;
    detach = adapters[method]?.subscribe?.(() => {
      // Interactive login reads the final accounts itself. SDK events during it
      // must not launch a competing restore and invalidate that result.
      if (active === method && !disposed && state.status !== "connecting") void read(method, false);
    });
  }
  async function read(method: AuthMethod, interactive: boolean) {
    const ticket = ++generation;
    publish({ status: interactive ? "connecting" : "checking", session: null, error: null });
    try {
      const adapter = adapters[method];
      if (!adapter) throw new Error("Method unavailable");
      const accounts = validateAccounts(await (interactive ? adapter.login() : adapter.restore()));
      if (disposed || ticket !== generation) return;
      if (accounts.length === 0) {
        clear();
        publish({ status: "disconnected", session: null, error: null });
        return;
      }
      const accountId =
        accounts.find((account) => account.accountId === selected)?.accountId ??
        accounts[0]?.accountId;
      if (!accountId) throw new Error("Missing account");
      selected = accountId;
      const session = Object.freeze({
        method,
        network,
        accountId,
        accounts: Object.freeze(accounts.map((account) => Object.freeze(account))),
        contextKey: `${method}:${network}:${accountId}`,
      });
      save(method, accountId);
      publish({ status: "connected", session, error: null });
    } catch {
      if (disposed || ticket !== generation) return;
      clear();
      publish({
        status: "error",
        session: null,
        error: "Sign-in was not completed. Try again or choose another method.",
      });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async restore() {
      if (disposed) return;
      requireIdle();
      generation++;
      let hint: unknown;
      try {
        const raw = storage?.getItem(key);
        if (raw && raw.length <= 512) hint = JSON.parse(raw);
      } catch {
        /* Ignore corrupt preferences. */
      }
      if (!hint || typeof hint !== "object") {
        clear();
        publish({ status: "disconnected", session: null, error: null });
        return;
      }
      const value = hint as Record<string, unknown>;
      if (
        (value.method !== "near-auth" && value.method !== "near-connect") ||
        typeof value.accountId !== "string"
      ) {
        clear();
        publish({ status: "disconnected", session: null, error: null });
        return;
      }
      selected = value.accountId;
      watch(value.method);
      await read(value.method, false);
    },
    async login(method: AuthMethod) {
      if (disposed) return;
      requireIdle();
      clear();
      watch(method);
      await read(method, true);
    },
    selectAccount(accountId: string) {
      const session = state.session;
      if (
        disposed ||
        !session ||
        !session.accounts.some((account) => account.accountId === accountId)
      )
        throw new Error("Select an account supplied by the connected provider.");
      selected = accountId;
      save(session.method, accountId);
      publish({
        status: "connected",
        session: Object.freeze({
          ...session,
          accountId,
          contextKey: `${session.method}:${network}:${accountId}`,
        }),
        error: null,
      });
    },
    async logout() {
      if (disposed) return;
      requireIdle();
      const adapter = active ? adapters[active] : undefined;
      const ticket = ++generation;
      clear();
      publish({ status: "signing-out", session: null, error: null });
      try {
        await adapter?.logout();
        if (!disposed && ticket === generation)
          publish({ status: "disconnected", session: null, error: null });
      } catch {
        if (!disposed && ticket === generation)
          publish({
            status: "error",
            session: null,
            error:
              "Disconnected from Mr.Fund, but provider sign-out was not confirmed. Close its window and try again.",
          });
      }
    },
    dispose() {
      disposed = true;
      generation++;
      detach?.();
      listeners.clear();
    },
  };
}
