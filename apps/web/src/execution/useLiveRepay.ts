"use client";
import { createOutcomeReader, createRheaClient } from "@mrfund/rhea";
import { useMemo, useSyncExternalStore } from "react";
import type { LiveAccountView } from "../play/source/liveSession";
import { connectSigningWallet } from "../wallet/near-connect";
import { publicExecutionConfig } from "./config";
import { createLiveRepay, type RepayView } from "./live";
import { createTransactionSigner } from "./signer";

const IDLE: RepayView = { phase: "idle" };
const noSubscribe = () => () => {};

/** One repay executor per live account; NEAR Auth sessions get no signer (E5). */
export function useLiveRepay(account: LiveAccountView | undefined, rpcUrl: string | undefined) {
  const accountId = account?.accountId;
  const network = account?.network;
  const method = account?.method;
  const store = useMemo(() => {
    if (!accountId || !network || !method || !rpcUrl) return null;
    const wallet = method === "near-connect" ? connectSigningWallet(network) : null;
    return createLiveRepay({
      accountId,
      network,
      config: publicExecutionConfig(),
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
