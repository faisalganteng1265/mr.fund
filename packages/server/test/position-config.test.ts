import { describe, expect, it } from "vitest";
import { networkAccount, readPositionConfig } from "../src/position/config";

const env = {
  NEAR_NETWORK_ID: "testnet",
  NEAR_RPC_URL: "https://rpc.example",
  RHEA_LENDING_ID: "lending.testnet",
};
describe("explicit public read configuration", () => {
  it("requires explicit server choices without browser, fee or model fallbacks", () => {
    expect(readPositionConfig(env)).toEqual({
      network: "testnet",
      rpcUrl: "https://rpc.example/",
      lendingId: "lending.testnet",
    });
    expect(
      readPositionConfig({
        NEXT_PUBLIC_NEAR_NETWORK_ID: "testnet",
        NEXT_PUBLIC_NEAR_RPC_URL: "https://rpc.example",
      }),
    ).toBeNull();
    for (const key of Object.keys(env))
      expect(readPositionConfig({ ...env, [key]: undefined })).toBeNull();
  });
  it.each([
    "http://rpc.example",
    "https://user:secret@rpc.example",
    "https://rpc.example/#secret",
    "not a URL",
  ])("rejects invalid RPC configuration %s", (NEAR_RPC_URL) => {
    expect(readPositionConfig({ ...env, NEAR_RPC_URL })).toBeNull();
  });
  it("rejects foreign-network and malformed lending targets", () => {
    for (const RHEA_LENDING_ID of ["lending.near", "LENDING.testnet", "https://lending.testnet"])
      expect(readPositionConfig({ ...env, RHEA_LENDING_ID })).toBeNull();
    expect(readPositionConfig({ ...env, NEAR_NETWORK_ID: "localnet" })).toBeNull();
  });
  it("recognizes the testnet root, descendants and network-neutral implicit accounts", () => {
    for (const id of ["testnet", "alice.testnet"]) {
      expect(networkAccount(id, "testnet")).toBe(true);
      expect(networkAccount(id, "mainnet")).toBe(false);
    }
    expect(networkAccount("alice.near", "mainnet")).toBe(true);
    expect(networkAccount("alice.near", "testnet")).toBe(false);
    for (const network of ["testnet", "mainnet"] as const) {
      expect(networkAccount("a".repeat(64), network)).toBe(true);
      expect(networkAccount("A".repeat(64), network)).toBe(false);
    }
  });
});
