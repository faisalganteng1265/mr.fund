import type { ConversationMessage } from "@mrfund/agent";

export interface LiveChatRequest {
  message: string;
  accountId: string;
  history: ConversationMessage[];
  locale?: "en" | "id" | "es";
}

/** Keep the newest contiguous history that fits the server's limits. */
export function buildLiveChatRequest(input: {
  message: string;
  accountId: string;
  history: readonly ConversationMessage[];
  locale?: string;
}): LiveChatRequest {
  if (!input.message.trim() || input.message.length > 4000) {
    throw new Error("Invalid message");
  }
  const history: ConversationMessage[] = [];
  let length = 0;
  for (let index = input.history.length - 1; index >= 0 && history.length < 20; index--) {
    const item = input.history[index];
    if (!item || item.content.length > 4000 || length + item.content.length > 16_000) break;
    history.unshift({ role: item.role, content: item.content });
    length += item.content.length;
  }
  const locale = input.locale;
  return {
    message: input.message,
    accountId: input.accountId,
    history,
    ...(locale === "en" || locale === "id" || locale === "es" ? { locale } : {}),
  };
}
