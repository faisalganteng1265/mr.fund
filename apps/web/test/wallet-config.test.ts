import { describe, expect, it } from "vitest";
import { readWalletConfig } from "../src/wallet/config";

const configured = { network: "testnet", rpcUrl: "https://test.rpc.fastnear.com" };
describe("browser login configuration", () => {
  it.each([undefined, "", "localnet", "MAINNET"])(
    "refuses an absent or unknown network: %s",
    (network) => {
      expect(() => readWalletConfig({ ...configured, network })).toThrow();
    },
  );
  it.each([
    undefined,
    "",
    "javascript:alert(1)",
    "https://user:password@rpc.example",
    "http://rpc.example",
  ])("refuses invalid public RPC configuration: %s", (rpcUrl) => {
    expect(() => readWalletConfig({ ...configured, rpcUrl })).toThrow();
  });
  it("uses the documented public development client only on testnet", () => {
    expect(readWalletConfig(configured)).toMatchObject({
      network: "testnet",
      auth: {
        clientId: "np8paqIpMWmNbzT4xAvOOapZBjsOpptl",
        domain: "login.testnet.fast-auth.com",
        contractId: "fast-auth.testnet",
        mpcId: "v1.signer-prod.testnet",
      },
    });
  });
  it("keeps ecosystem wallets available without mainnet Auth credentials", () => {
    expect(readWalletConfig({ ...configured, network: "mainnet" }).auth).toBeNull();
    expect(
      readWalletConfig({ ...configured, network: "mainnet", authClientId: "approved-client" }).auth,
    ).toMatchObject({
      clientId: "approved-client",
      domain: "login.auth.near.org",
      contractId: "fast-auth.near",
      mpcId: "v1.signer",
    });
  });
  it("rejects the shared testnet client on mainnet and malformed supplied client ids", () => {
    expect(() =>
      readWalletConfig({
        ...configured,
        network: "mainnet",
        authClientId: "np8paqIpMWmNbzT4xAvOOapZBjsOpptl",
      }),
    ).toThrow();
    expect(() => readWalletConfig({ ...configured, authClientId: " bad client " })).toThrow();
  });
});
