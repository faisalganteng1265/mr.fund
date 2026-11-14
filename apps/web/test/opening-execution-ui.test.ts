// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveOpening, OpeningView } from "../src/execution/open-position-live";
import { OpeningExecution } from "../src/play/OpeningExecution";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const HASH = "7fVZ6aHCNXnz8VzM6uz5jzH6oUxYy1bJwbV3aD1Eo2Gv";
const wire = (action: string) => ({
  id: "card-1",
  action,
  headline: "Borrow 0.5 REF",
  payload: [
    {
      receiverId: "contract.testnet",
      actions: [{ methodName: "execute_with_pyth", args: {}, gas: "100", deposit: "1" }],
    },
  ],
  fees: [],
});
const store = (over: Partial<LiveOpening> = {}) =>
  ({
    status: () => "idle",
    prepare: vi.fn(async () => {}),
    cancel: vi.fn(),
    confirm: vi.fn(async () => {}),
    check: vi.fn(async () => {}),
    ...over,
  }) as unknown as LiveOpening;
const show = (view: OpeningView, s: LiveOpening | null = store(), action = "wallet_borrow") =>
  render(
    createElement(OpeningExecution, { card: wire(action), store: s, view, onSettled: () => {} }),
  );

const tokens = {
  collateral: { symbol: "wNEAR", decimals: 24, extraDecimals: 0 },
  debt: { symbol: "REF", decimals: 18, extraDecimals: 0 },
};
const BANNED = ["never get liquidated", "guaranteed yield", "risk-free", "free borrowing"];
const honest = (text: string) => {
  for (const b of BANNED) expect(text.toLowerCase()).not.toContain(b);
  expect(text.toLowerCase()).not.toMatch(/\bsafe\b/);
};
const confirmView = (over = {}): OpeningView => ({
  phase: "confirm",
  cardId: "card-1",
  confirmation: {
    stage: "borrow",
    amount: "0.5 REF",
    fee: { amount: "0.1 USDC", recipientId: "fees.testnet" },
    registrations: [{ receiverId: "ref.fakes.testnet", near: "0.00125 NEAR" }],
    lines: [
      { label: "Health factor", value: "210 % → 150 %" },
      { label: "Borrow APR", value: "1.81 %" },
    ],
    risks: ["Prices can move and liquidation is possible."],
    lendingId: "contract.testnet",
    network: "testnet",
    accountId: "alice.testnet",
    ...over,
  },
});

describe("opening execution surface", () => {
  it("renders nothing for another kind of card", () => {
    const { container } = show({ phase: "idle" }, store(), "repay");
    expect(container.textContent).toBe("");
  });

  it("says execution is unavailable without a store", () => {
    show({ phase: "idle" }, null);
    expect(screen.getByText(/unavailable for this session/)).toBeTruthy();
  });

  it("the button only prepares the card; nothing is signed from it", () => {
    const s = store();
    show({ phase: "idle" }, s);
    fireEvent.click(screen.getByRole("button", { name: "Review and execute" }));
    expect(s.prepare).toHaveBeenCalledOnce();
    expect(s.confirm).not.toHaveBeenCalled();
  });

  it("a submitted card cannot be executed again", () => {
    show({ phase: "idle" }, store({ status: () => "done" }));
    expect(
      (screen.getByRole("button", { name: "Review and execute" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("states why execution is blocked and lets the user close it", () => {
    const s = store();
    show(
      { phase: "blocked", cardId: "card-1", reason: "Your position changed since this card." },
      s,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/position changed/);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(s.cancel).toHaveBeenCalledOnce();
  });

  it("the confirmation shows principal, fee, registration, numbers, risks, network and account before the wallet", () => {
    const { container } = show(confirmView());
    const text = container.textContent ?? "";
    for (const part of [
      "0.5 REF from contract.testnet",
      "0.1 USDC to fees.testnet",
      "0.00125 NEAR to register with ref.fakes.testnet",
      "210 % → 150 %",
      "1.81 %",
      "liquidation is possible",
      "testnet",
      "alice.testnet",
    ])
      expect(text).toContain(part);
    honest(text);
  });

  it("a deposit confirmation reads as a deposit", () => {
    const { container } = show(confirmView({ stage: "deposit", amount: "0.5 wNEAR" }));
    expect(container.textContent).toContain("0.5 wNEAR into contract.testnet");
    expect(screen.getByRole("region", { name: "Confirm deposit" })).toBeTruthy();
  });

  it("Adjust cancels without opening the wallet; Open wallet signs this card once", () => {
    const s = store();
    show(confirmView(), s);
    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
    expect(s.cancel).toHaveBeenCalledOnce();
    expect(s.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open wallet" }));
    expect(s.confirm).toHaveBeenCalledOnce();
    expect((s.confirm as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      id: "card-1",
    });
  });

  it("shows a waiting state while the wallet is open", () => {
    show({ phase: "signing", cardId: "card-1" });
    expect(screen.getByRole("status").textContent).toMatch(/Waiting for your wallet/);
  });
});

describe("opening result surface", () => {
  const result = (state: string, extra = {}, summary: unknown = null) =>
    ({
      phase: "result",
      cardId: "card-1",
      tokens,
      summary,
      run: {
        kind: "result",
        result: {
          state,
          reason: "applied",
          applied: { registration: null, main: true, fee: null },
          txHashes: [HASH],
          main: null,
          observed: {
            collateralBefore: 10n ** 24n,
            collateralAfter: 15n * 10n ** 23n,
            debtBefore: 0n,
            debtAfter: 5n * 10n ** 17n,
            walletDebtDelta: null,
            healthAfter: 15_000,
            blockHeight: 1,
            readAtMs: 1_800_000_000_000,
          },
          ...extra,
        },
      },
    }) as unknown as OpeningView;

  it("a confirmed result shows observed numbers and links only after evidence", () => {
    vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK_ID", "testnet");
    vi.stubEnv("NEXT_PUBLIC_RHEA_LENDING_ID", "contract.testnet");
    vi.stubEnv("NEXT_PUBLIC_FEE_RECIPIENT_ID", "fees.testnet");
    const { container } = show(result("confirmed"));
    const text = container.textContent ?? "";
    expect(text).toContain("Confirmed from the chain.");
    expect(text).toContain("1 wNEAR → 1.5 wNEAR");
    expect(text).toContain("0 REF → 0.5 REF");
    expect(text).toContain("150%");
    expect(screen.getByRole("link").getAttribute("href")).toMatch(/nearblocks.*7fVZ6aHC/);
    honest(text);
  });

  it("a pending result offers Check again and shows no explorer link", () => {
    vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK_ID", "testnet");
    vi.stubEnv("NEXT_PUBLIC_RHEA_LENDING_ID", "contract.testnet");
    vi.stubEnv("NEXT_PUBLIC_FEE_RECIPIENT_ID", "fees.testnet");
    const s = store();
    show(result("submitted", { txHashes: [] }), s);
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(s.check).toHaveBeenCalledOnce();
  });

  it("shows the flow headline only when the store provides one", () => {
    const { container, rerender } = show(result("confirmed"));
    expect(container.textContent).not.toContain("Deposit applied");
    rerender(
      createElement(OpeningExecution, {
        card: wire("wallet_borrow"),
        store: store(),
        view: result("confirmed", {}, { headline: "Deposit and borrow applied." }),
        onSettled: () => {},
      }),
    );
    expect(container.textContent).toContain("Deposit and borrow applied.");
  });

  it("an observed change after a wallet error is not called a confirmation", () => {
    const { container } = show({
      phase: "result",
      cardId: "card-1",
      tokens,
      summary: null,
      run: {
        kind: "observed_change",
        collateralBeforeInternal: 0n,
        collateralAfterInternal: 10n ** 24n,
        debtBeforeInternal: 0n,
        debtAfterInternal: 0n,
      },
    });
    expect(container.textContent).toMatch(/observed change, not a confirmation/);
  });

  it("nothing observed says nothing was sent that can be seen", () => {
    const { container } = show({
      phase: "result",
      cardId: "card-1",
      tokens,
      summary: null,
      run: { kind: "nothing_observed" },
    });
    expect(container.textContent).toMatch(/did not change/);
  });
});
