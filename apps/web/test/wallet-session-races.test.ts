import { EventEmitter, once } from "node:events";
import { describe, expect, it } from "vitest";
import { createWalletSession } from "../src/wallet/session";
import type { AuthAdapter, ConnectedAccount } from "../src/wallet/types";

function gate() {
  const event = new EventEmitter();
  return { wait: () => once(event, "release"), open: () => event.emit("release") };
}
const alice = [{ accountId: "alice.testnet" }];
function provider(): { adapter: AuthAdapter; change(): void } {
  let connected = false;
  let changed = () => {};
  return {
    adapter: {
      method: "near-connect",
      async login() {
        connected = true;
        return alice;
      },
      async restore() {
        return connected ? alice : [];
      },
      async logout() {
        connected = false;
        changed();
      },
      subscribe(listener) {
        changed = listener;
        return () => {
          changed = () => {};
        };
      },
    },
    change: () => changed(),
  };
}

describe("provider operation isolation", () => {
  it("rejects competing operations and rechecks sign-in events only after interactive login settles", async () => {
    const p = provider();
    const pending = gate();
    let candidates: readonly ConnectedAccount[] = [];
    p.adapter.login = async () => {
      await pending.wait();
      candidates = alice;
      return alice;
    };
    p.adapter.restore = async () => candidates;
    const session = createWalletSession("testnet", { "near-connect": p.adapter });
    const first = session.login("near-connect");
    const blockedLogin = expect(session.login("near-connect")).rejects.toThrow();
    const blockedRestore = expect(session.restore()).rejects.toThrow();
    const blockedLogout = expect(session.logout()).rejects.toThrow();
    p.change();
    pending.open();
    await Promise.all([first, blockedLogin, blockedRestore, blockedLogout]);
    expect(session.getSnapshot().session?.accountId).toBe("alice.testnet");
    session.dispose();
  });
  it("does not let an old remote logout delete a new connection", async () => {
    const p = provider();
    const pending = gate();
    const finishLogout = p.adapter.logout;
    p.adapter.logout = async () => {
      await pending.wait();
      await finishLogout();
    };
    const session = createWalletSession("testnet", { "near-connect": p.adapter });
    await session.login("near-connect");
    const oldLogout = session.logout();
    const blockedLogin = expect(session.login("near-connect")).rejects.toThrow();
    const blockedRestore = expect(session.restore()).rejects.toThrow();
    const blockedLogout = expect(session.logout()).rejects.toThrow();
    pending.open();
    await Promise.all([oldLogout, blockedLogin, blockedRestore, blockedLogout]);
    await session.login("near-connect");
    expect(session.getSnapshot().session?.accountId).toBe("alice.testnet");
    expect(await p.adapter.restore()).toEqual(alice);
    session.dispose();
  });
  it("never publishes a passive restore result that finishes after logout", async () => {
    const p = provider();
    const pending = gate();
    const saved = JSON.stringify({ method: "near-connect", accountId: "alice.testnet" });
    const storage = { getItem: () => saved, setItem: () => {}, removeItem: () => {} };
    p.adapter.restore = async () => {
      await pending.wait();
      return alice;
    };
    const session = createWalletSession("testnet", { "near-connect": p.adapter }, storage);
    const restoring = session.restore();
    await session.logout();
    pending.open();
    await restoring;
    expect(session.getSnapshot().session).toBeNull();
    expect(session.getSnapshot().status).toBe("disconnected");
  });
  it("never publishes a login result after disposal", async () => {
    const p = provider();
    const pending = gate();
    p.adapter.login = async () => {
      await pending.wait();
      return alice;
    };
    const session = createWalletSession("testnet", { "near-connect": p.adapter });
    const login = session.login("near-connect");
    session.dispose();
    pending.open();
    await login;
    expect(session.getSnapshot().session).toBeNull();
  });
  it("clears local identity even when remote logout fails without pretending the provider signed out", async () => {
    const p = provider();
    const session = createWalletSession("testnet", { "near-connect": p.adapter });
    await session.login("near-connect");
    p.adapter.logout = async () => {
      throw new Error("secret provider token");
    };
    await session.logout();
    expect(session.getSnapshot().session).toBeNull();
    expect(session.getSnapshot().status).toBe("error");
    expect(JSON.stringify(session.getSnapshot())).not.toContain("secret provider token");
    expect(await p.adapter.restore()).toEqual(alice);
  });
});
