// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { statusLine } from "../src/wallet/copy";
import {
  type AdapterFactory,
  loadAdapters,
  useWalletSession,
  WalletProvider,
  type WalletSession,
} from "../src/wallet/react";
import type { AuthAdapter, AuthMethod, ConnectedAccount } from "../src/wallet/types";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const env = () => ({ network: "testnet", rpcUrl: "https://rpc.testnet.near.org" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeAdapters(accounts: readonly ConnectedAccount[] = [{ accountId: "alice.testnet" }]) {
  const calls = { login: 0, logout: 0, restore: 0 };
  let pending: ReturnType<typeof deferred<readonly ConnectedAccount[]>> | null = null;
  let logoutFails = false;
  const adapter = (method: AuthMethod): AuthAdapter => ({
    method,
    async restore() {
      calls.restore++;
      return [];
    },
    login() {
      calls.login++;
      if (pending) return pending.promise;
      return Promise.resolve(accounts);
    },
    async logout() {
      calls.logout++;
      if (logoutFails) throw new Error("popup blocked");
    },
  });
  const factory: AdapterFactory = async () => ({
    "near-auth": adapter("near-auth"),
    "near-connect": adapter("near-connect"),
  });
  return {
    calls,
    factory,
    hold() {
      pending = deferred();
      return pending;
    },
    failLogout() {
      logoutFails = true;
    },
  };
}

const seen: { current: WalletSession | null } = { current: null };
function Probe() {
  const session = useWalletSession();
  seen.current = session;
  return createElement("output", null, session.state.status);
}
function mount(factory: AdapterFactory, envFn: () => ReturnType<typeof env> | object = env) {
  seen.current = null;
  const view = render(
    createElement(
      WalletProvider,
      { env: envFn as typeof env, adapters: factory },
      createElement(Probe),
    ),
  );
  return { seen, view };
}
const flush = () => act(async () => {});

describe("WalletProvider", () => {
  it("renders the checking state on the server without touching browser APIs", () => {
    const html = renderToString(
      createElement(
        WalletProvider,
        { env, adapters: fakeAdapters().factory },
        createElement(Probe),
      ),
    );
    expect(html).toContain("checking");
  });

  it("restores passively, then mirrors controller snapshots", async () => {
    const f = fakeAdapters();
    const { seen } = mount(f.factory);
    await flush();
    expect(f.calls).toMatchObject({ restore: 0, login: 0 }); // no hint: no provider call, no prompt
    expect(screen.getByText("disconnected")).toBeTruthy();
    await act(() => seen.current?.login("near-connect"));
    expect(seen.current?.state).toBe(seen.current?.controller?.getSnapshot());
    expect(seen.current?.state.session).toMatchObject({
      method: "near-connect",
      network: "testnet",
      accountId: "alice.testnet",
    });
  });

  it("starts only one provider operation on double activation", async () => {
    const f = fakeAdapters();
    const { seen } = mount(f.factory);
    await flush();
    const held = f.hold();
    let first: Promise<void> | undefined;
    act(() => {
      first = seen.current?.login("near-auth");
      void seen.current?.login("near-auth");
      void seen.current?.login("near-connect");
    });
    expect(f.calls.login).toBe(1);
    expect(seen.current?.busy).toBe(true);
    held.resolve([{ accountId: "alice.testnet" }]);
    await act(async () => first);
    expect(seen.current?.state.status).toBe("connected");
  });

  it("ignores provider results that arrive after unmount", async () => {
    const f = fakeAdapters();
    const { seen, view } = mount(f.factory);
    await flush();
    const held = f.hold();
    const controller = seen.current?.controller;
    act(() => {
      void seen.current?.login("near-connect");
    });
    view.unmount();
    held.resolve([{ accountId: "alice.testnet" }]);
    await flush();
    expect(controller?.getSnapshot().status).toBe("connecting");
    expect(localStorage.length).toBe(0);
  });

  it("blocks real login with an explicit message when configuration is missing", async () => {
    const f = fakeAdapters();
    const { seen } = mount(f.factory, () => ({ rpcUrl: "https://rpc.testnet.near.org" }));
    await flush();
    expect(seen.current?.state).toMatchObject({
      status: "error",
      error: "Set NEXT_PUBLIC_NEAR_NETWORK_ID to testnet or mainnet.",
    });
    expect(seen.current?.available).toEqual([]);
    await act(() => seen.current?.login("near-connect"));
    expect(f.calls.login).toBe(0);
  });

  it("reports a provider load failure instead of throwing during render", async () => {
    const { seen } = mount(async () => {
      throw new Error("chunk failed");
    });
    await flush();
    expect(seen.current?.state).toMatchObject({ status: "error" });
    expect(seen.current?.configError).toMatch(/could not load/);
  });

  it("keeps NEAR Auth unavailable on mainnet without an approved client id", async () => {
    const built = await loadAdapters({
      network: "mainnet",
      rpcUrl: "https://rpc.mainnet.near.org/",
      auth: null,
    });
    expect(Object.keys(built)).toEqual(["near-connect"]);
  });

  it("says the device is signed out, not fully signed out, when provider logout fails", async () => {
    const f = fakeAdapters();
    const { seen } = mount(f.factory);
    await flush();
    await act(() => seen.current?.login("near-connect"));
    f.failLogout();
    await act(() => seen.current?.logout());
    const state = seen.current?.state;
    expect(state?.status).toBe("error");
    const line = state ? statusLine(state, "testnet") : null;
    expect(line).toMatch(/This device is signed out; the provider session may remain/);
    expect(line).not.toMatch(/fully signed out/i);
  });
});

describe("landing bundle stays wallet-free", () => {
  it("imports no wallet module from the landing route", () => {
    const root = join(__dirname, "../src");
    const files = [
      join(root, "app/page.tsx"),
      join(root, "app/layout.tsx"),
      ...readdirSync(join(root, "landing")).map((f) => join(root, "landing", f)),
    ].filter((f) => /\.tsx?$/.test(f));
    for (const file of files)
      expect(readFileSync(file, "utf8")).not.toMatch(/wallet\/|near-connect|auth0/);
  });
});
