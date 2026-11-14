import { assembleCard } from "@mrfund/engine";
import type { Card } from "@mrfund/shared";
import { amount, percent } from "../display";
import type { Advice, ChatEvent, ChatPort, GuardianView, PositionView, Receipt } from "./types";

interface ChatContext {
  position: PositionView;
  advice: Advice;
  guardian: GuardianView;
  receipts: Receipt[];
}
export function createDemoChat(
  read: (amount: string) => ChatContext,
  rememberCard?: (card: Card, value: string) => void,
): ChatPort {
  return {
    provenance: "simulated",
    send(request, signal) {
      const { position, advice, guardian: state, receipts } = read(request.amount);
      const { debt, dataState, current } = position;
      const { comp, whatIf, card } = advice;
      const { guardian, reserve, spendable, savedFields, watcherOnline } = state;
      const unavailable = dataState !== "fresh";
      const question = request.message;
      const q = question.toLowerCase();
      const indo = /kalau|harga|aku|berapa|jelas|aman|batas|apa |bayar|utang/.test(q);
      let text =
        "I can explain your Rhea position, compare repaying with earning yield, run a price-drop scenario, or explain Guardian. Try one of the prompts below.";
      let kind: "recommendation" | "scenario" | undefined;
      if (unavailable)
        text =
          dataState === "empty"
            ? "There isn't a lending position in this demo state. Switch back to Fresh in Demo settings to explore the full flow. A real position would be opened on Rhea."
            : "I need fresh position data before giving you numbers. Refresh the position first; I won't guess.";
      else if (/what if|drops|drop|turun|kalau/.test(q) && whatIf.ok) {
        text = indo
          ? `Skenario simulasi: kalau harga NEAR turun 20%, health factor menjadi ${percent(whatIf.value.value.healthBps)}. Batas likuidasi Rhea adalah 100%. Masih di atas batas pada skenario ini, tetapi risikonya tetap ada.`
          : `In this simulated 20% NEAR price drop, your health becomes ${percent(whatIf.value.value.healthBps)}. Rhea's liquidation line is 100%. You stay above it in this scenario, with less room for another drop.`;
        kind = "scenario";
      } else if (/guardian|batas|reserve|protect|limit|what did|why didn/.test(q)) {
        if (guardian === "inactive")
          text = indo
            ? "Guardian menggunakan cadangan untuk membayar utang sesuai batas yang kamu tentukan. Pinjaman yang dilindungi harus berada di akun Guardian. Coba setup demo melalui panel Guardian."
            : "Think of Guardian as your rules, on watch. It can repay a Guardian-held loan from a reserve, within your caps and cooldown. Your existing wallet loan stays separate. Open the setup to try it.";
        else if (/what did|today|history/.test(q))
          text = `Guardian is ${guardian}. ${receipts.filter((r) => /Guardian|request|reserve/.test(r.title)).length} demo events are in Activity. Every attempt has a simulated receipt there, including rejected requests.`;
        else if (/why didn/.test(q))
          text = !watcherOnline
            ? "The simulated watcher is offline. No automatic action can be requested while it's offline."
            : guardian !== "active"
              ? `Guardian is ${guardian}; automatic requests are blocked.`
              : "No automatic repay is needed at the current demo health. You can run a labelled trigger replay from the Guardian panel.";
        else
          text = `Guardian is ${guardian}. Reserve: ${amount(reserve)} USDC; spendable above your floor: ${amount(spendable)} USDC. Each action is capped at ${savedFields.max} USDC, lifetime spend at ${savedFields.cap} USDC, with a ${savedFields.cooldown}-minute cooldown. Trigger: health below ${savedFields.trigger}%. Activation fee: 1.00 test USDC; action fee: 0.00. Watcher: ${watcherOnline ? "online" : "offline"}. It reduces risk within your limits; it cannot prevent liquidation. Pause, deactivate, or withdraw from the Guardian panel.`;
      } else if (/repay|yield|smartest|bayar|interest/.test(q) && comp.ok) {
        text = indo
          ? `Dengan ${amount(comp.value.value.amountUsed)} USDC, membayar utang menghemat sekitar ${amount(comp.value.value.repaySaves)} USDC per tahun. Supply menghasilkan sekitar ${amount(comp.value.value.yieldEarns)} USDC. Dalam contoh ini, bayar utang lebih menguntungkan sebelum biaya.`
          : `Let's put that cash to work on your debt. Repaying ${amount(comp.value.value.amountUsed)} USDC avoids an estimated ${amount(comp.value.value.repaySaves)} USDC in yearly interest. Supplying it earns ${amount(comp.value.value.yieldEarns)} USDC. Repaying wins before fees.`;
        kind = "recommendation";
      } else if (/position|health|utang|jelas/.test(q))
        text = `Your demo position has 1,000 NEAR in collateral and ${amount(debt)} USDC in debt. Health: ${current.health === null ? "unavailable" : percent(current.health)}. Borrow APR is 21.00%; supply APR is 14.01%. These are illustrative inputs, refreshed for this demo. Below 100% health, Rhea can liquidate a position.`;
      else if (/bitcoin|ethereum|trade|buy|leverage|ignore|10000|10,000/.test(q))
        text =
          "That action is outside this demo's permissions. I can help with the supported Rhea debt and Guardian limits. A chat message never authorizes a transaction.";
      return (async function* (): AsyncIterable<ChatEvent> {
        signal.throwIfAborted();
        yield {
          type: "progress",
          stage: "tools",
          ...(kind === "scenario"
            ? { tool: "what_if_price" }
            : kind === "recommendation"
              ? { tool: "propose_card" }
              : {}),
        };
        signal.throwIfAborted();
        yield { type: "text", text };
        signal.throwIfAborted();
        if (kind === "recommendation" && card?.ok) {
          const recommendation = assembleCard(card.value, {
            id: "demo-repay",
            reason: "",
            payload: [],
          });
          rememberCard?.(recommendation, request.amount);
          yield { type: "card", card: recommendation };
        }
        signal.throwIfAborted();
        yield {
          type: "done",
          summary: {
            via: "template",
            guardHits: 0,
            toolCalls: 0,
            providerCalls: 0,
            elapsedMs: 0,
            usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 },
            status: "ok",
          },
        };
      })();
    },
  };
}
