"use client";
import { createOutcomeReader, createRheaClient } from "@mrfund/rhea";
import { useMemo, useSyncExternalStore } from "react";
import type { LiveAccountView } from "../play/source/liveSession";
import { connectSigningWallet } from "../wallet/near-connect";
import { publicOpeningConfig } from "./config";
import { createLiveOpening, type OpeningView } from "./open-position-live";
import { createTransactionSigner } from "./signer";

const IDLE: OpeningView = { phase: "idle" };
const noSubscribe = () => () => {};

/** One opening executor per live account; NEAR Auth sessions get no signer (E5). */
export function useLiveOpening(account: LiveAccountView | undefined, rpcUrl: string | undefined) {
  const accountId = account?.accountId;
  const network = account?.network;
  const method = account?.method;
  const store = useMemo(() => {
    if (!accountId || !network || !method || !rpcUrl) return null;
    const wallet = method === "near-connect" ? connectSigningWallet(network) : null;
    return createLiveOpening({
      accountId,
      network,
      config: publicOpeningConfig(),
      rhea: createRheaClient(rpcUrl),
      reader: createOutcomeReader(rpcUrl, network),
      signer: wallet ? createTransactionSigner({ method, accountId, network }, wallet) : null,
    });
  }, [accountId, network, method, rpcUrl]);
  const view = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? (() => IDLE),
    () => IDLE,
  );
  return { store, view };
}
