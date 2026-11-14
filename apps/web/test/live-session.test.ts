// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceTag } from "../src/play/ProvenanceTag";
import { createDemoSource } from "../src/play/source/demoSource";
import { createLiveSessionPort, withLiveSession } from "../src/play/source/liveSession";
import { WalletDialog } from "../src/play/WalletDialog";
import type { WalletSession } from "../src/wallet/react";
import type { WalletState } from "../src/wallet/session";

vi.mock("next/image", () => ({
  default: (props: { alt: string }) => createElement("img", { alt: props.alt }),
}));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

const connected = (method: "near-auth" | "near-connect", ids = ["alice.testnet"]): WalletState => ({
  status: "connected",
  error: null,
  session: {
    method,
    network: "testnet",
    accountId: ids[0] ?? "",
    accounts: ids.map((accountId) => ({ accountId })),
    contextKey: `${method}:testnet:${ids[0]}`,
  },
});

function store(initial: WalletState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: WalletState) {
      state = next;
      for (const l of listeners) l();
    },
  };
}

describe("live session port", () => {
  it("maps controller state to a live, stable session view without a balance read", () => {
    const s = store({ status: "checking", session: null, error: null });
    const port = createLiveSessionPort(s, async () => {}, "testnet");
    expect(port.provenance).toBe("live");
    expect(port.networkLabel).toBe("NETWORK · TESTNET");
    const first = port.getSnapshot();
    expect(port.getSnapshot()).toBe(first);
    expect(first).toEqual({ connected: false, connecting: false, walletBalance: 0n });
    s.set(connected("near-connect", ["alice.testnet", "bob.testnet"]));
    expect(port.getSnapshot()).toEqual({
      connected: true,
      connecting: false,
      walletBalance: 0n,
      account: {
        method: "near-connect",
        network: "testnet",
        accountId: "alice.testnet",
        accounts: ["alice.testnet", "bob.testnet"],
      },
    });
    s.set({ status: "signing-out", session: null, error: null });
    expect(port.getSnapshot()).toMatchObject({ connected: false, connecting: true });
  });

  it("refuses a method-less connect and signs out through the controller", async () => {
    const logout = vi.fn(async () => {});
    const port = createLiveSessionPort(
      store({ status: "disconnected", session: null, error: null }),
      logout,
      "testnet",
    );
    await expect(port.connect()).rejects.toThrow(/NEAR Auth or NEAR Connect/);
    port.disconnect();
    expect(logout).toHaveBeenCalledOnce();
  });

  it("keeps every other port simulated, so their labels stay visible", () => {
    const demo = createDemoSource();
    const session = createLiveSessionPort(store(connected("near-auth")), async () => {}, "testnet");
    const mixed = withLiveSession(demo, session);
    expect(mixed.session.provenance).toBe("live");
    for (const port of [mixed.position, mixed.chat, mixed.execution, mixed.guardian])
      expect(port.provenance).toBe("simulated");
    render(
      createElement("div", null, [
        createElement(ProvenanceTag, { key: "live", port: mixed.session, label: "ignored" }),
        createElement(ProvenanceTag, {
          key: "sim",
          port: mixed.position,
          label: "POSITION · SIMULATED",
        }),
      ]),
    );
    expect(screen.getByText("NETWORK · TESTNET")).toBeTruthy();
    expect(screen.getByText("POSITION · SIMULATED")).toBeTruthy();
    expect(() =>
      render(createElement(ProvenanceTag, { port: mixed.position, label: "POSITION" })),
    ).toThrow(/simulation label/);
  });
});

function wallet(state: WalletState, over: Partial<WalletSession> = {}): WalletSession {
  return {
    controller: null,
    network: "testnet",
    available: ["near-auth", "near-connect"],
    configError: null,
    state,
    busy: state.status === "connecting" || state.status === "signing-out",
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    selectAccount: vi.fn(),
    ...over,
  };
}

function dialog(w: WalletSession, over: { connected?: boolean } = {}) {
  const port = w.state.session
    ? createLiveSessionPort(store(w.state), async () => {}, "testnet")
    : createDemoSource().session;
  const props = {
    connected: over.connected ?? w.state.status === "connected",
    connecting: false,
    walletBalance: 0n,
    stage: "welcome" as const,
    port,
    close: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    setNotice: vi.fn(),
    wallet: w,
    liveConnected: vi.fn(),
  };
  render(createElement(WalletDialog, props));
  return props;
}

describe("wallet dialog", () => {
  it("offers both real methods and a separate, labelled simulated demo", () => {
    const w = wallet({ status: "disconnected", session: null, error: null });
    const p = dialog(w);
    fireEvent.click(screen.getByRole("button", { name: /NEAR Connect/ }));
    expect(w.login).toHaveBeenCalledWith("near-connect");
    expect(p.connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try the simulated demo" }));
    expect(p.connect).toHaveBeenCalledOnce();
  });

  it("shows a failed login with recovery and never switches to the demo", () => {
    const w = wallet({
      status: "error",
      session: null,
      error: "Sign-in was not completed. Try again or choose another method.",
    });
    const p = dialog(w);
    expect(screen.getByRole("status").textContent).toMatch(/must be on testnet/);
    expect(p.connect).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /NEAR Auth/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("disables every choice and the close action while a provider operation runs", () => {
    const w = wallet({ status: "connecting", session: null, error: null });
    const p = dialog(w);
    for (const name of [/NEAR Auth/, /NEAR Connect/, /simulated demo/])
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(p.close).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/finish signing in/);
  });

  it("marks an unconfigured method as unavailable", () => {
    dialog(
      wallet(
        { status: "disconnected", session: null, error: null },
        { available: ["near-connect"] },
      ),
    );
    const auth = screen.getByRole("button", { name: /NEAR Auth/ }) as HTMLButtonElement;
    expect(auth.disabled).toBe(true);
    expect(auth.textContent).toMatch(/Not configured/);
  });

  it("states that a NEAR Auth account is read-only and offers no sign action", () => {
    dialog(wallet(connected("near-auth")));
    expect(screen.getByText("alice.testnet")).toBeTruthy();
    expect(screen.getByText(/NEAR Auth · testnet/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Signing is not available/);
    expect(screen.queryByRole("button", { name: /^sign$|approve|sign transaction/i })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("lists exactly the provider's accounts and selects among them", () => {
    const w = wallet(connected("near-connect", ["alice.testnet", "bob.testnet"]));
    dialog(w);
    const picker = screen.getByRole("combobox") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toEqual(["alice.testnet", "bob.testnet"]);
    expect(picker.value).toBe("alice.testnet");
    fireEvent.change(picker, { target: { value: "bob.testnet" } });
    expect(w.selectAccount).toHaveBeenCalledWith("bob.testnet");
    fireEvent.click(screen.getByRole("button", { name: /Sign out on this device/ }));
    expect(w.logout).toHaveBeenCalledOnce();
  });
});
