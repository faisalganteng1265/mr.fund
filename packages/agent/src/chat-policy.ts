import type {
  ConversationMessage,
  ProviderMessage,
  ProviderReply,
  TurnSummary,
} from "./chat-types";

/** Provider responses are an untrusted runtime boundary, even for injected adapters. */
export function validReply(value: unknown): value is ProviderReply {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const reply = value as Partial<ProviderReply>;
  if (
    typeof reply.content !== "string" ||
    reply.content.length > 32_000 ||
    !Array.isArray(reply.toolCalls) ||
    typeof reply.usage !== "object" ||
    reply.usage === null
  )
    return false;
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cachedInputTokens",
    "reasoningTokens",
  ] as const) {
    const count = reply.usage[key];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return false;
  }
  // An overflowing batch is refused by the caller before any dispatch, not truncated silently.
  if (reply.toolCalls.length > 6) return true;
  return reply.toolCalls.every(
    (call) =>
      typeof call === "object" &&
      call !== null &&
      typeof call.id === "string" &&
      /^[!-~]{1,128}$/.test(call.id) &&
      typeof call.name === "string" &&
      /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(call.name) &&
      typeof call.arguments === "string" &&
      call.arguments.length <= 16_000,
  );
}

/** Copy only bounded conversational prose. No history field can impersonate a tool or system. */
export function conversationHistory(
  history: readonly ConversationMessage[] | undefined,
): ProviderMessage[] {
  if (!Array.isArray(history)) return [];
  const messages: ProviderMessage[] = [];
  let remaining = 20_000;
  for (let i = history.length - 1; i >= 0 && messages.length < 20 && remaining > 0; i--) {
    const value: unknown = history[i];
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const entry = value as Partial<ConversationMessage>;
    if ((entry.role !== "user" && entry.role !== "assistant") || typeof entry.content !== "string")
      continue;
    const content = entry.content.slice(0, Math.min(4_000, remaining));
    remaining -= content.length;
    messages.push({ role: entry.role, content });
  }
  return messages.reverse();
}

/** Deliberately number-free: a failed answer must not manufacture facts or repeat untrusted metadata. */
export function fallbackText(locale: string | undefined, status: TurnSummary["status"]): string {
  const language = locale?.toLowerCase().split(/[-_]/)[0];
  if (language === "id") {
    if (status === "timeout")
      return "Waktu permintaan habis. Silakan coba lagi. Tidak ada transaksi yang ditandatangani atau dikirim.";
    if (status === "cancelled")
      return "Permintaan dibatalkan. Tidak ada transaksi yang ditandatangani atau dikirim.";
    if (status !== "ok")
      return "Mr.Fund belum bisa berbicara sekarang. Silakan coba lagi. Tidak ada transaksi yang ditandatangani atau dikirim.";
    return "Saya belum bisa memverifikasi jawaban berdasarkan data alat saat ini. Silakan coba lagi. Tidak ada transaksi yang ditandatangani atau dikirim.";
  }
  if (language === "es") {
    if (status === "timeout")
      return "La solicitud agotó el tiempo de espera. Inténtalo de nuevo. No se ha firmado ni enviado ninguna transacción.";
    if (status === "cancelled")
      return "Solicitud cancelada. No se ha firmado ni enviado ninguna transacción.";
    if (status !== "ok")
      return "Mr.Fund no puede hablar ahora. Inténtalo de nuevo. No se ha firmado ni enviado ninguna transacción.";
    return "No pude verificar una respuesta con los datos actuales de las herramientas. Inténtalo de nuevo. No se ha firmado ni enviado ninguna transacción.";
  }
  if (status === "timeout")
    return "The request timed out. Please try again. Nothing was signed or sent.";
  if (status === "cancelled") return "Request cancelled. Nothing was signed or sent.";
  if (status !== "ok")
    return "Mr.Fund can't talk right now. Please try again. Nothing was signed or sent.";
  return "I couldn't verify an answer against current tool data. Please try again. Nothing was signed or sent.";
}
