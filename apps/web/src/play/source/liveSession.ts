import type { WalletState } from "../../wallet/session";
import type { AuthMethod, NearNetwork } from "../../wallet/types";
import type { ConsultationSource, SessionPort, SessionView, Store } from "./types";

export interface LiveAccountView {
  readonly method: AuthMethod;
  readonly network: NearNetwork;
  readonly accountId: string;
  /** Only the accounts the provider returned for this method and network (W1). */
  readonly accounts: readonly string[];
}

/**
 * A real wallet session as the consultation's `session` port (`provenance: "live"`).
 * Reads account context only: there is no balance read and no signing path, so
 * `walletBalance` stays 0 and live surfaces never display it. Login happens through the
 * wallet controller with an explicit method; `connect()` has no method and refuses.
 */
export function createLiveSessionPort(
  wallet: Store<WalletState>,
  logout: () => Promise<void>,
  network: NearNetwork,
): SessionPort {
  let seen: WalletState | null = null;
  let view: SessionView = { connected: false, connecting: false, walletBalance: 0n };
  const snapshot = (): SessionView => {
    const state = wallet.getSnapshot();
    if (state === seen) return view;
    seen = state;
    const session = state.status === "connected" ? state.session : null;
    view = {
      connected: session !== null,
      connecting: state.status === "connecting" || state.status === "signing-out",
      walletBalance: 0n,
      ...(session
        ? {
            account: {
              method: session.method,
              network: session.network,
              accountId: session.accountId,
              accounts: session.accounts.map((a) => a.accountId),
            },
          }
        : {}),
    };
    return view;
  };
  return {
    provenance: "live",
    networkLabel: `NETWORK · ${network.toUpperCase()}`,
    getSnapshot: snapshot,
    subscribe: (listener) => wallet.subscribe(listener),
    async connect() {
      throw new Error("Choose NEAR Auth or NEAR Connect to sign in.");
    },
    disconnect() {
      void logout();
    },
  };
}

/** Only the session port is live; every other port keeps its simulated provenance and label. */
export function withLiveSession(
  source: ConsultationSource,
  session: SessionPort,
): ConsultationSource {
  return {
    session,
    position: source.position,
    chat: source.chat,
    execution: source.execution,
    guardian: source.guardian,
    reset: () => source.reset(),
  };
}
