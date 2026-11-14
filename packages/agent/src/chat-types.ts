import type { Card } from "@mrfund/shared";
import type { SourceNumber } from "./numbers";
import type { ToolContext, ToolDefinition } from "./tools";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCalls?: ProviderToolCall[];
  toolCallId?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
}

export interface ProviderReply {
  content: string;
  toolCalls: ProviderToolCall[];
  usage: TokenUsage;
}

export interface ChatProvider {
  complete(input: {
    messages: readonly ProviderMessage[];
    tools: readonly ToolDefinition[];
    signal: AbortSignal;
  }): Promise<ProviderReply>;
}

export type ChatEvent =
  | { type: "progress"; stage: "reading" | "thinking" | "tools" | "checking"; tool?: string }
  | { type: "text"; text: string }
  | { type: "card"; card: Card }
  | {
      type: "error";
      code: "unavailable" | "timeout" | "cancelled" | "tool_limit" | "invalid_provider";
    }
  | { type: "done"; summary: TurnSummary };

export interface TurnSummary {
  via: "model" | "template";
  guardHits: number;
  toolCalls: number;
  providerCalls: number;
  elapsedMs: number;
  usage: TokenUsage;
  status: "ok" | "unavailable" | "timeout" | "cancelled" | "tool_limit" | "invalid_provider";
}

export interface TurnResult {
  text: string;
  cards: Card[];
  sources: SourceNumber[];
  summary: TurnSummary;
}

export interface ChatTurnInput {
  message: string;
  history?: readonly ConversationMessage[];
  locale?: string;
  context: ToolContext;
  provider: ChatProvider;
  signal?: AbortSignal;
  emit?: (event: ChatEvent) => void;
}
