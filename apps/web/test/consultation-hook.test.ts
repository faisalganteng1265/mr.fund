// @vitest-environment jsdom

import { assembleCard } from "@mrfund/engine";
import type { Card } from "@mrfund/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createDemoSource } from "../src/play/source/demoSource";
import type { ConsultationSource } from "../src/play/source/types";
import { useConsultation } from "../src/play/useConsultation";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("clears an in-progress turn without stale reply or thinking state", async () => {
  vi.useFakeTimers();
  const source = createDemoSource();
  const { result } = renderHook(() => useConsultation(source));
  act(() => result.current.sendMessage("Explain my position"));
  expect(result.current.thinking).toBe(true);
  act(() => result.current.clearConversation());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(result.current.thinking).toBe(false);
  expect(result.current.messages).toHaveLength(1);
  expect(result.current.streamingId).toBeNull();
});
it("replaces a pending turn instead of accepting an obsolete reply", async () => {
  vi.useFakeTimers();
  const source = createDemoSource();
  const { result } = renderHook(() => useConsultation(source));
  act(() => result.current.sendMessage("Explain my position"));
  act(() => result.current.sendMessage("What if NEAR drops 20%?"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  const replies = result.current.messages.filter((message) => message.role === "assistant");
  expect(replies).toHaveLength(2);
  expect(replies[1]?.kind).toBe("scenario");
  expect(replies[1]?.text).not.toContain("Your demo position has");
});

it("binds a non-demo streamed card to review and approval until an explicit adjustment", async () => {
  vi.useFakeTimers();
  const base = createDemoSource();
  const connection = base.session.connect();
  await vi.advanceTimersByTimeAsync(700);
  await connection;
  const draft = base.position.advice("250").card;
  if (!draft?.ok) throw new Error("Expected fixture draft");
  const card = assembleCard(draft.value, {
    id: "remote-card",
    reason: "Engine-backed proposal",
    payload: [],
  });
  let prepared: Card | undefined;
  const source: ConsultationSource = {
    ...base,
    position: {
      ...base.position,
      advice(value, selected) {
        return base.position.advice(selected ? "250" : value);
      },
    },
    execution: {
      ...base.execution,
      prepareRepay(value, selected) {
        prepared = selected;
        return base.execution.prepareRepay(selected ? "250" : value);
      },
    },
    chat: {
      provenance: "live",
      async *send() {
        yield { type: "text", text: "Repay 250 USDC." };
        yield { type: "card", card };
      },
    },
  };
  const { result } = renderHook(() => useConsultation(source));
  act(() => result.current.sendMessage("Repay"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(result.current.card?.ok && result.current.card.value.headline).toBe("Repay 250 USDC");
  act(() => result.current.executeCard());
  expect(prepared).toBe(card);
  expect(result.current.pending?.amount).toBe("250.10 test USDC");
  act(() => result.current.setRepayAmount("125"));
  expect(result.current.card?.ok && result.current.card.value.headline).toBe("Repay 125 USDC");
  act(() => result.current.executeCard());
  expect(prepared).toBeUndefined();
  expect(result.current.pending?.amount).toBe("125.10 test USDC");
});

it("discards delayed non-demo text and cards after a cleared turn", async () => {
  vi.useFakeTimers();
  const base = createDemoSource();
  const draft = base.position.advice("250").card;
  if (!draft?.ok) throw new Error("Expected fixture draft");
  const card = assembleCard(draft.value, { id: "late-card", reason: "", payload: [] });
  const source: ConsultationSource = {
    ...base,
    chat: {
      provenance: "live",
      async *send() {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        yield { type: "text", text: "Obsolete 250 USDC reply" };
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        yield { type: "card", card };
      },
    },
  };
  const { result } = renderHook(() => useConsultation(source));
  act(() => result.current.sendMessage("Repay"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2150);
  });
  act(() => result.current.clearConversation());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(result.current.messages).toHaveLength(1);
  expect(result.current.cardOpen).toBe(false);
  expect(result.current.thinking).toBe(false);
});
