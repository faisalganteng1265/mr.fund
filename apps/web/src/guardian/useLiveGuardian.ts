"use client";
import { createGuardianClient } from "@mrfund/guardian-client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createTransactionSigner } from "../execution/signer";
import type { LiveAccountView } from "../play/source/liveSession";
import { connectSigningWallet } from "../wallet/near-connect";
import { type GuardianConfigResult, publicGuardianConfig } from "./config";
import { createLiveGuardian, type LiveGuardianView } from "./live";

const LOADING: LiveGuardianView = {
  state: { status: "loading" },
  submission: null,
  busy: false,
  notice: null,
  signBlocked: null,
  loan: null,
};
const noSubscribe = () => () => {};

/**
 * One live Guardian store per account and network. A signer exists only for a NEAR Connect
 * session whose wallet provider registered a signing surface; everything else is view-only.
 */
export function useLiveGuardian(
  account: LiveAccountView,
  config: GuardianConfigResult = publicGuardianConfig(),
) {
  const { accountId, network, method } = account;
  const ready = config.ok && config.value.network === network ? config.value : null;
  const rpcUrl = ready?.rpcUrl;
  const factoryId = ready?.factoryId;
  const store = useMemo(() => {
    if (!rpcUrl || !factoryId) return null;
    const wallet = method === "near-connect" ? connectSigningWallet(network) : null;
    return createLiveGuardian({
      client: createGuardianClient(rpcUrl),
      network,
      factoryId,
      ownerId: accountId,
      signer: wallet ? createTransactionSigner({ method, accountId, network }, wallet) : null,
    });
  }, [rpcUrl, factoryId, accountId, network, method]);
  useEffect(() => {
    void store?.refresh();
  }, [store]);
  const view = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? (() => LOADING),
    () => LOADING,
  );
  return {
    view,
    store,
    actionFee: ready?.actionFee ?? null,
    blocked: config.ok
      ? ready
        ? null
        : "The wallet network does not match the configured Guardian network."
      : config.reason,
  };
}
