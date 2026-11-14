import { ArrowUpRight, Copy, LoaderCircle, LockKeyhole, LogOut, Wallet } from "lucide-react";
import Image from "next/image";
import { capabilityLine, METHOD_LABEL, statusLine } from "../wallet/copy";
import type { WalletSession } from "../wallet/react";
import { amount } from "./display";
import { ModalFrame } from "./ModalFrame";
import { ProvenanceTag } from "./ProvenanceTag";
import type { Port, SessionView } from "./source/types";

interface Props extends SessionView {
  stage: "welcome" | "consult";
  port: Port;
  close: () => void;
  connect: () => void;
  disconnect: () => void;
  setNotice: (text: string) => void;
  /** Real wallet session; the demo stays a separate, explicit choice. */
  wallet: WalletSession;
  liveConnected: () => void;
}
const providers = [
  {
    method: "near-auth",
    logo: "/play/tokens/near.svg",
    treatment: "invert",
    hint: "Passkey or social",
  },
  {
    method: "near-connect",
    logo: "/play/wallets/meteor.svg",
    treatment: "",
    hint: "Meteor, Intear and more",
  },
] as const;
export function WalletDialog({
  connected,
  connecting,
  walletBalance,
  stage,
  port,
  close,
  connect,
  disconnect,
  setNotice,
  wallet,
  liveConnected,
}: Props) {
  const live = wallet.state.status === "connected" ? wallet.state.session : null;
  const status = statusLine(wallet.state, wallet.network);
  const blocked = wallet.busy || connecting;
  async function signIn(method: (typeof providers)[number]["method"]) {
    await wallet.login(method);
    // The consultation source switches to the live session once the controller reports it.
    if (wallet.controller?.getSnapshot().status === "connected") liveConnected();
  }
  return (
    <ModalFrame
      wallet
      eyebrow="YOUR CONSULTATION"
      title={
        live
          ? "Your wallet."
          : connected
            ? "Your mock wallet."
            : stage === "welcome"
              ? "Connect to begin."
              : "Come on in."
      }
      close={() => {
        // Escape and the close button wait while a provider operation is running.
        if (!blocked) close();
      }}
    >
      <span className="mt-5 inline-flex items-center gap-2 text-[9px] font-medium tracking-[.08em] text-[#a2a4a5]">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-[#bad7c3]" />
        <ProvenanceTag port={port} label="NETWORK · TESTNET · SIMULATED" />
      </span>
      <p
        role="status"
        aria-live="polite"
        className="mt-4! max-w-[320px] text-[13px] leading-[1.8] text-[#a2a4a5]"
      >
        {live
          ? capabilityLine(live.method)
          : connected
            ? "Connected to a local demo identity. These tokens are simulated balances."
            : (status ?? "Meet Mr.Fund with a demo wallet, or sign in with your own account.")}
      </p>
      {live ? (
        <>
          <div className="wallet-account flex items-center gap-[10px] p-[16px_0_24px] [&_b]:text-[12px] [&_small]:text-[10px] [&_small]:text-[#a2a4a5] [&_small]:block [&_small]:mt-[5px] [&_.icon-button]:ml-auto">
            <span className="wallet-avatar h-[40px] w-[40px] bg-[var(--lime)] text-[#101a17]! grid place-items-center rounded-full font-[family-name:var(--font-display)] text-[21px] uppercase">
              {live.accountId.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <b className="block truncate">{live.accountId}</b>
              <small>
                {METHOD_LABEL[live.method]} · {live.network}
              </small>
            </div>
            <button
              type="button"
              className="icon-button inline-flex items-center justify-center border-0 bg-transparent w-[32px] h-[32px] rounded-full p-0 [transition:background_.18s] [&:hover]:bg-[#8080801a]"
              aria-label="Copy account id"
              onClick={() => {
                navigator.clipboard?.writeText(live.accountId);
                setNotice("Account id copied.");
              }}
            >
              <Copy size={16} />
            </button>
          </div>
          {live.accounts.length > 1 && (
            <label className="-mt-2 mb-5 block text-[10px] text-[#a2a4a5]">
              Account
              <select
                className="mt-2 block w-full rounded-[9px] border border-solid border-[#313334] bg-transparent p-[10px_12px] text-[12px] text-[#edf3f5]"
                value={live.accountId}
                disabled={blocked}
                onChange={(e) => wallet.selectAccount(e.target.value)}
              >
                {live.accounts.map((account) => (
                  <option key={account.accountId} value={account.accountId}>
                    {account.accountId}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={blocked}
            className="button border-0 inline-flex items-center justify-center gap-[12px] p-[13px_17px] min-h-[43px] rounded-[9px] text-[11px]! font-bold! [transition:transform_.17s,background_.17s,box-shadow_.17s] [&:hover:not(:disabled)]:transform-[translateY(-2px)] [&:hover:not(:disabled)]:shadow-none [&:active:not(:disabled)]:transform-[translateY(0)] outline-button [border:1px_solid_#313334] bg-transparent [&:hover]:bg-[#ffffff40] full-width w-full disabled:cursor-wait"
            onClick={() => void wallet.logout()}
          >
            <LogOut size={17} />
            Sign out on this device
          </button>
        </>
      ) : connected ? (
        <>
          <div className="wallet-account flex items-center gap-[10px] p-[16px_0_24px] [&_b]:text-[12px] [&_small]:text-[10px] [&_small]:text-[#a2a4a5] [&_small]:block [&_small]:mt-[5px] [&_.icon-button]:ml-auto">
            <span className="wallet-avatar h-[40px] w-[40px] bg-[var(--lime)] text-[#101a17]! grid place-items-center rounded-full font-[family-name:var(--font-display)] text-[21px]">
              Y
            </span>
            <div>
              <b>you.demo.testnet</b>
              <small>{amount(walletBalance)} test USDC available</small>
            </div>
            <button
              type="button"
              className="icon-button inline-flex items-center justify-center border-0 bg-transparent w-[32px] h-[32px] rounded-full p-0 [transition:background_.18s] [&:hover]:bg-[#8080801a]"
              aria-label="Copy mock account"
              onClick={() => {
                navigator.clipboard?.writeText("you.demo.testnet");
                setNotice("Mock account copied.");
              }}
            >
              <Copy size={16} />
            </button>
          </div>
          <button
            type="button"
            className="button border-0 inline-flex items-center justify-center gap-[12px] p-[13px_17px] min-h-[43px] rounded-[9px] text-[11px]! font-bold! [transition:transform_.17s,background_.17s,box-shadow_.17s] [&:hover:not(:disabled)]:transform-[translateY(-2px)] [&:hover:not(:disabled)]:shadow-none [&:active:not(:disabled)]:transform-[translateY(0)] [&.small]:p-[10px_13px] [&.small]:min-h-[35px] [&.small]:text-[10px]! [&.small]:gap-[8px] [&.small]:rounded-[7px] outline-button [border:1px_solid_#313334] bg-transparent [&:hover]:bg-[#ffffff40] full-width w-full"
            onClick={disconnect}
          >
            <LogOut size={17} />
            Disconnect mock wallet
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            aria-label={connecting ? "Connecting the simulated demo" : "Try the simulated demo"}
            className="group relative mt-7 flex w-full flex-col items-stretch gap-6 overflow-hidden rounded-[22px] border-0 bg-[#d3e5d7] p-5 text-left text-[#203327] transition-colors hover:bg-[#e1efe4] disabled:cursor-wait sm:p-6"
            disabled={blocked}
            onClick={connect}
          >
            <div className="flex items-start justify-between">
              {connecting ? (
                <LoaderCircle size={30} className="animate-spin" />
              ) : (
                <Wallet size={30} strokeWidth={1.4} />
              )}
              <span className="text-[9px] font-semibold uppercase tracking-[.15em] text-[#52685b]">
                Demo access / 01
              </span>
            </div>
            <div className="flex items-end justify-between gap-4">
              <div>
                <b className="block font-[family-name:var(--font-display)] text-[25px] font-medium leading-tight tracking-[-.8px]">
                  Simulated demo
                </b>
                <small className="mt-2 block text-[11px] text-[#52685b]">
                  {connecting
                    ? "Connecting to the simulated testnet…"
                    : "1,000 test USDC · instant connection"}
                </small>
              </div>
              <ArrowUpRight
                size={26}
                strokeWidth={1.5}
                className="mb-1 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transform-none"
              />
            </div>
          </button>
          <div className="pb-2 pt-7">
            <p className="text-center text-[11px] text-[#858d89]">
              Or sign in with your own account.
            </p>
            <div className="mx-auto mt-5 grid max-w-[280px] grid-cols-2 gap-6">
              {providers.map((provider) => {
                const available = wallet.available.includes(provider.method);
                return (
                  <button
                    type="button"
                    key={provider.method}
                    disabled={blocked || !available}
                    aria-describedby={`wallet-hint-${provider.method}`}
                    onClick={() => void signIn(provider.method)}
                    className="flex cursor-pointer flex-col items-center gap-3 rounded-[14px] border-0 bg-transparent p-2 text-[11px] font-medium text-[#bbc3be] transition-colors hover:bg-[#ffffff12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bad7c3] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Image
                      src={provider.logo}
                      alt=""
                      width={40}
                      height={40}
                      className={`size-10 object-contain ${provider.treatment}`}
                    />
                    {METHOD_LABEL[provider.method]}
                    <span
                      id={`wallet-hint-${provider.method}`}
                      className="text-[9px] text-[#747c78]"
                    >
                      {available ? provider.hint : "Not configured"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-5! text-center text-[10px] text-[#747c78]">
              Signing in only reads your account id. Nothing is signed.
            </p>
          </div>
        </>
      )}
      <p className="mt-6! flex items-center justify-center gap-2 text-[10px] leading-relaxed text-[#8b948f]">
        <LockKeyhole size={12} />
        Mr.Fund never asks for your private key.
      </p>
    </ModalFrame>
  );
}
