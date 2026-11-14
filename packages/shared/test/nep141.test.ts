import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CardDraft,
  feeTransfers,
  ftTransfer,
  ftTransferCall,
  isValidAccountId,
  ONE_YOCTO,
  storageDeposit,
} from "../src/index";

interface Case {
  name: string;
  build: Record<string, string>;
  receiver_id: string;
  method: string;
  args_json: string;
  deposit: string;
}
const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../fixtures/encodings.json"), "utf8"),
) as { cases: Case[] };
const byName = (n: string): Case => {
  const c = fixture.cases.find((x) => x.name === n);
  if (!c) throw new Error(`no case ${n}`);
  return c;
};

function assertMatches(
  tx: { receiverId: string; actions: { methodName: string; args: unknown; deposit: bigint }[] },
  c: Case,
) {
  expect(tx.receiverId).toBe(c.receiver_id);
  expect(tx.actions).toHaveLength(1);
  const a = tx.actions[0];
  expect(a?.methodName).toBe(c.method);
  expect(JSON.stringify(a?.args)).toBe(c.args_json);
  expect(a?.deposit).toBe(BigInt(c.deposit));
}

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};

describe("encodings match the shared vectors byte for byte", () => {
  it("ft_transfer_call with OnlyRepay", () => {
    const c = byName("wallet_repay");
    const b = c.build;
    assertMatches(
      unwrap(
        ftTransferCall(b.tokenId ?? "", b.receiverId ?? "", BigInt(b.amount ?? "0"), b.msg ?? ""),
      ),
      c,
    );
  });

  it("ft_transfer_call to a Guardian", () => {
    const c = byName("guardian_repay");
    const b = c.build;
    assertMatches(
      unwrap(
        ftTransferCall(b.tokenId ?? "", b.receiverId ?? "", BigInt(b.amount ?? "0"), b.msg ?? ""),
      ),
      c,
    );
  });

  it("ft_transfer", () => {
    const c = byName("fee_transfer");
    const b = c.build;
    assertMatches(
      unwrap(ftTransfer(b.tokenId ?? "", b.receiverId ?? "", BigInt(b.amount ?? "0"))),
      c,
    );
  });

  it("storage_deposit with registration_only", () => {
    const c = byName("storage_deposit");
    const b = c.build;
    assertMatches(
      unwrap(storageDeposit(b.tokenId ?? "", b.accountId ?? "", BigInt(b.deposit ?? "0"))),
      c,
    );
  });
});

describe("builders validate their inputs", () => {
  const T = "usdc.fakes.testnet";
  const R = "contract.1689937928.burrow.testnet";

  it("attach exactly one yocto to token transfers", () => {
    const tx = unwrap(ftTransfer(T, R, 1n));
    expect(tx.actions[0]?.deposit).toBe(ONE_YOCTO);
    expect(ONE_YOCTO).toBe(1n);
  });

  it("keep the amount as a decimal string, never a number", () => {
    const tx = unwrap(ftTransfer(T, R, 2n ** 100n));
    expect(tx.actions[0]?.args.amount).toBe((2n ** 100n).toString());
  });

  it.each([0n, -1n, 2n ** 128n])("refuse amount %s", (amount) => {
    expect(ftTransfer(T, R, amount).ok).toBe(false);
    expect(ftTransferCall(T, R, amount, "x").ok).toBe(false);
  });

  it("accepts the largest u128", () => {
    expect(ftTransfer(T, R, 2n ** 128n - 1n).ok).toBe(true);
  });

  it.each(["", "A.testnet", "a", "a..b", ".a", "a.", "a b", "x".repeat(65), "a@b", "-a", "a-"])(
    "refuse account id %j",
    (id) => {
      expect(isValidAccountId(id)).toBe(false);
      expect(ftTransfer(id, R, 1n).ok).toBe(false);
      expect(ftTransfer(T, id, 1n).ok).toBe(false);
    },
  );

  it.each(["alice.testnet", "usdc.fakes.testnet", "a-b_c.near", "ab", "x".repeat(64), "0123abcd"])(
    "accept account id %j",
    (id) => expect(isValidAccountId(id)).toBe(true),
  );

  it("refuses a negative storage deposit", () => {
    expect(storageDeposit(T, R, -1n).ok).toBe(false);
    expect(storageDeposit(T, R, 0n).ok).toBe(false);
  });
});

describe("feeTransfers", () => {
  const draft = (fees: CardDraft["fees"]): Pick<CardDraft, "fees"> => ({ fees });
  const fee = {
    label: "Execution fee",
    amount: 100_000n,
    tokenId: "usdc.fakes.testnet",
    recipientId: "fees.testnet",
    when: "Once.",
  };

  it("is empty when there is no fee", () => {
    expect(unwrap(feeTransfers(draft([]), { recipientRegistered: true }))).toEqual([]);
  });

  it("is one ft_transfer when the recipient is registered", () => {
    const txs = unwrap(feeTransfers(draft([fee]), { recipientRegistered: true }));
    expect(txs).toHaveLength(1);
    assertMatches(txs[0] as never, byName("fee_transfer"));
  });

  it("registers the recipient first when it is not, using the supplied deposit", () => {
    const txs = unwrap(
      feeTransfers(draft([fee]), {
        recipientRegistered: false,
        storageDepositYocto: 1_250_000_000_000_000_000_000n,
      }),
    );
    expect(txs).toHaveLength(2);
    assertMatches(txs[0] as never, byName("storage_deposit"));
    assertMatches(txs[1] as never, byName("fee_transfer"));
  });

  it("refuses an unregistered recipient when no deposit amount is known", () => {
    const r = feeTransfers(draft([fee]), { recipientRegistered: false });
    expect(r.ok).toBe(false);
  });

  it("refuses more than one fee line", () => {
    expect(feeTransfers(draft([fee, fee]), { recipientRegistered: true }).ok).toBe(false);
  });
});
