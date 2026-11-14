// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveRepay, RepayView } from "../src/execution/live";
import { RepayExecution } from "../src/play/RepayExecution";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const HASH = "7fVZ6aHCNXnz8VzM6uz5jzH6oUxYy1bJwbV3aD1Eo2Gv";
const TOKEN = { id: "usdc.testnet", symbol: "USDC", decimals: 6, extraDecimals: 12 };
const wire = {
  id: "card-1",
  action: "repay",
  headline: "Repay 50 USDC",
  payload: [
    {
      receiverId: "usdc.testnet",
      actions: [{ methodName: "ft_transfer_call", args: {}, gas: "100", deposit: "1" }],
    },
  ],
  fees: [{ amount: "250000" }],
};
const store = (over: Partial<LiveRepay> = {}) =>
  ({
    status: () => "idle",
    prepare: vi.fn(async () => {}),
    cancel: vi.fn(),
    confirm: vi.fn(async () => {}),
    check: vi.fn(async () => {}),
    ...over,
  }) as unknown as LiveRepay;
const show = (view: RepayView, s = store()) =>
  render(createElement(RepayExecution, { card: wire, store: s, view, onSettled: () => {} }));

const BANNED = ["never get liquidated", "guaranteed yield", "risk-free", "free borrowing"];
const honest = (text: string) => {
  for (const b of BANNED) expect(text.toLowerCase()).not.toContain(b);
  expect(text.toLowerCase()).not.toMatch(/\bsafe\b/);
};

describe("repay execution surface", () => {
  it("Execute prepares the card; nothing is signed from the button itself", () => {
    const s = store();
    show({ phase: "idle" }, s);
    fireEvent.click(screen.getByRole("button", { name: "Execute now" }));
    expect(s.prepare).toHaveBeenCalledOnce();
    expect(s.confirm).not.toHaveBeenCalled();
  });

  it("a submitted card cannot be executed again", () => {
    show({ phase: "idle" }, store({ status: () => "done" }));
    expect(
      (screen.getByRole("button", { name: "Execute now" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("states why execution is blocked", () => {
    show({ phase: "blocked", cardId: "card-1", reason: "This account cannot sign transactions." });
    expect(screen.getByRole("alert").textContent).toMatch(/cannot sign/);
  });

  it("the confirmation shows amount, fee with recipient, network and account before the wallet", () => {
    const s = store();
    const { container } = show(
      {
        phase: "confirm",
        cardId: "card-1",
        confirmation: {
          amount: "50 USDC",
          tokenId: TOKEN.id,
          fee: { amount: "0.25 USDC", recipientId: "fees.testnet" },
          registrationNear: "0.00125 NEAR",
          lendingId: "rhea.testnet",
          network: "testnet",
          accountId: "alice.testnet",
        },
      },
      s,
    );
    const text = container.textContent ?? "";
    for (const part of [
      "50 USDC to rhea.testnet",
      "0.25 USDC to fees.testnet",
      "0.00125 NEAR",
      "testnet",
      "alice.testnet",
    ])
      expect(text).toContain(part);
    honest(text);
    fireEvent.click(screen.getByRole("button", { name: "Open wallet" }));
    expect(s.confirm).toHaveBeenCalledOnce();
  });

  it("pending: Check again and no explorer link", () => {
    vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK_ID", "testnet");
    vi.stubEnv("NEXT_PUBLIC_RHEA_LENDING_ID", "rhea.testnet");
    vi.stubEnv("NEXT_PUBLIC_FEE_RECIPIENT_ID", "fees.testnet");
    const s = store();
    show(
      {
        phase: "result",
        cardId: "card-1",
        token: TOKEN,
        result: { kind: "receipt", receipt: { status: "submitted", txHashes: [HASH], atMs: 1 } },
      },
      s,
    );
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(s.check).toHaveBeenCalledOnce();
  });

  it("confirmed: observed values with their time and a network explorer link", () => {
    vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK_ID", "testnet");
    vi.stubEnv("NEXT_PUBLIC_RHEA_LENDING_ID", "rhea.testnet");
    vi.stubEnv("NEXT_PUBLIC_FEE_RECIPIENT_ID", "fees.testnet");
    const { container } = show({
      phase: "result",
      cardId: "card-1",
      token: TOKEN,
      result: {
        kind: "receipt",
        receipt: {
          status: "confirmed",
          txHashes: [HASH],
          atMs: Date.UTC(2026, 10, 11),
          observed: {
            debtBeforeInternal: (200n * 10n ** 18n).toString(),
            debtAfterInternal: (150n * 10n ** 18n).toString(),
            debtDecreaseInternal: (50n * 10n ** 18n).toString(),
            suppliedChangeInternal: "0",
            healthBeforeBps: "15000",
            healthAfterBps: "20000",
          },
        },
      },
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Repay confirmed from the chain.");
    expect(text).toContain("200 USDC");
    expect(text).toContain("150 USDC");
    expect(text).toContain("150% → 200% (observed)");
    expect(text).toContain("2026-11-11T00:00:00.000Z");
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      `https://testnet.nearblocks.io/txns/${HASH}`,
    );
    honest(text);
  });

  it("a wallet error never reads as confirmed", () => {
    const { container } = show({
      phase: "result",
      cardId: "card-1",
      token: TOKEN,
      result: {
        kind: "observed_change",
        debtBeforeInternal: 200n * 10n ** 18n,
        debtAfterInternal: 150n * 10n ** 18n,
      },
    });
    const text = container.textContent ?? "";
    expect(text).toMatch(/not a confirmation/);
    expect(text).not.toMatch(/confirmed/i);
  });

  it("a card that cannot be decoded is refused", () => {
    render(
      createElement(RepayExecution, {
        card: { ...wire, fees: [{ amount: 1.5 }] },
        store: store(),
        view: { phase: "idle" },
        onSettled: () => {},
      }),
    );
    expect(screen.getByRole("alert").textContent).toMatch(/could not be read/);
  });
});

describe("repay execution at 360 px", () => {
  it("lets long account and contract ids wrap inside the confirmation and receipt grids", () => {
    // jsdom has no layout; this pins the wrapping utilities that keep a 34-character lending id
    // from widening the grid past a 360 px chat column.
    const { container } = show({
      phase: "confirm",
      cardId: "card-1",
      confirmation: {
        amount: "50 USDC",
        tokenId: TOKEN.id,
        fee: null,
        registrationNear: null,
        lendingId: "contract.1689937928.burrow.testnet",
        network: "testnet",
        accountId: "valtrum-8875bb.testnet",
      },
    });
    const grid = container.querySelector("dl");
    expect(grid?.className).toContain("[&_dd]:min-w-0");
    expect(grid?.className).toContain("[&_dd]:[overflow-wrap:anywhere]");
  });
});
