import { describe, expect, it } from "vitest";
import { parsePositionSelectors } from "../src/position/selectors";

describe("strict public position selectors", () => {
  it("accepts exactly two public selectors", () => {
    expect(parsePositionSelectors('{"accountId":"alice.testnet","networkId":"testnet"}')).toEqual({
      accountId: "alice.testnet",
      networkId: "testnet",
    });
    expect(
      parsePositionSelectors(new URLSearchParams("accountId=alice.testnet&networkId=testnet")),
    ).toEqual({ accountId: "alice.testnet", networkId: "testnet" });
  });
  it.each([
    '{"accountId":"alice.testnet","networkId":"testnet","network\\u0049d":"testnet"}',
    '{"accountId":"alice.testnet","accountId":"bob.testnet","networkId":"testnet"}',
    '{"accountId":"alice.testnet","networkId":"testnet","rpcUrl":"https://evil.example"}',
    '{"accountId":"alice.testnet","networkId":"testnet","lendingId":"evil.testnet"}',
    '{"accountId":"Alice.testnet","networkId":"testnet"}',
    '{"accountId":"https://alice.testnet","networkId":"testnet"}',
    '{"accountId":"alice.testnet"}',
    "null",
    "[]",
    "{",
  ])("rejects duplicate, unknown or malformed JSON %s", (raw) => {
    expect(() => parsePositionSelectors(raw)).toThrow();
  });
  it("rejects duplicate and extra query fields", () => {
    for (const query of [
      "accountId=alice.testnet&networkId=testnet&networkId=testnet",
      "accountId=alice.testnet&networkId=testnet&rpcUrl=https://evil.example",
    ])
      expect(() => parsePositionSelectors(new URLSearchParams(query))).toThrow();
  });
});
