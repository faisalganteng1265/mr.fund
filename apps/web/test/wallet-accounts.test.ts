import { describe, expect, it } from "vitest";
import { validateAccounts } from "../src/wallet/accounts";

const key = `ed25519:${"1".repeat(32)}`;
describe("provider account candidates", () => {
  it("retains only valid account context and never identity tokens or profile fields", () => {
    expect(
      validateAccounts([
        {
          accountId: "alice.testnet",
          publicKey: key,
          email: "private@example.com",
          token: "not-authority",
        },
        { accountId: "bob.testnet" },
      ]),
    ).toEqual([{ accountId: "alice.testnet", publicKey: key }, { accountId: "bob.testnet" }]);
    expect(validateAccounts([])).toEqual([]);
  });
  it.each([
    null,
    {},
    "alice.testnet",
    [{ accountId: "A.testnet" }],
    [{ accountId: "x" }],
    [{ accountId: "alice.testnet", publicKey: "private-key" }],
    [{ accountId: "alice.testnet", publicKey: `ed25519:${"1".repeat(31)}` }],
    [{ accountId: "alice.testnet" }, { accountId: "alice.testnet" }],
    Array.from({ length: 21 }, (_, i) => ({ accountId: `account${i}.testnet` })),
  ])("refuses malformed or ambiguous provider account lists", (value) => {
    expect(() => validateAccounts(value)).toThrow();
  });
});
