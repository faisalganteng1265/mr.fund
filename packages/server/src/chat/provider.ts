import type { ChatProvider, ProviderReply, ProviderToolCall } from "@mrfund/agent";
import { readBoundedBody, record } from "../transport";

/** Bounded GLM reasoning; the evaluator records these exact runtime settings. */
export const CHAT_GENERATION_SETTINGS = {
  temperature: 0.2,
  max_tokens: 3072,
  thinking_token_budget: 256,
} as const;

/** Server-only credentials. Redirects/custom credential destinations are deliberately forbidden. */
export function createNearAIProvider(config: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): ChatProvider {
  let endpoint: URL;
  try {
    const base = new URL(config.baseUrl ?? "https://cloud-api.near.ai/v1");
    if (
      base.origin !== "https://cloud-api.near.ai" ||
      !["/v1", "/v1/"].includes(base.pathname) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !config.apiKey.trim() ||
      !config.model.trim() ||
      config.model.length > 200
    )
      throw new Error();
    endpoint = new URL("/v1/chat/completions", base);
  } catch {
    throw new Error("Invalid chat provider configuration");
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    async complete(input): Promise<ProviderReply> {
      try {
        input.signal.throwIfAborted();
        const response = await fetchImpl(endpoint.toString(), {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
          signal: input.signal,
          body: JSON.stringify({
            model: config.model,
            ...CHAT_GENERATION_SETTINGS,
            stream: false,
            messages: input.messages.map((message) => ({
              role: message.role,
              content: message.content,
              ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
              ...(message.toolCalls === undefined
                ? {}
                : {
                    tool_calls: message.toolCalls.map((call) => ({
                      id: call.id,
                      type: "function",
                      function: { name: call.name, arguments: call.arguments },
                    })),
                  }),
            })),
            tools: input.tools.map((tool) => ({ type: "function", function: tool })),
            tool_choice: "auto",
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error();
        }
        const body: unknown = JSON.parse(
          await readBoundedBody(response.body, 524_288, input.signal),
        );
        if (
          !record(body) ||
          !Array.isArray(body.choices) ||
          body.choices.length !== 1 ||
          !record(body.choices[0]) ||
          !record(body.choices[0].message)
        )
          throw new Error();
        const message = body.choices[0].message;
        if (
          message.content !== null &&
          message.content !== undefined &&
          typeof message.content !== "string"
        )
          throw new Error();
        const content = message.content ?? "";
        if (typeof content !== "string" || content.length > 32_000) throw new Error();
        const rawCalls = message.tool_calls ?? [];
        if (!Array.isArray(rawCalls) || rawCalls.length > 32) throw new Error();
        const ids = new Set<string>();
        const toolCalls: ProviderToolCall[] = rawCalls.map((call: unknown) => {
          if (
            !record(call) ||
            call.type !== "function" ||
            typeof call.id !== "string" ||
            !call.id ||
            call.id.length > 128 ||
            ids.has(call.id) ||
            !record(call.function) ||
            typeof call.function.name !== "string" ||
            !/^[a-zA-Z0-9_]{1,64}$/.test(call.function.name) ||
            typeof call.function.arguments !== "string" ||
            call.function.arguments.length > 16_384
          )
            throw new Error();
          ids.add(call.id);
          return { id: call.id, name: call.function.name, arguments: call.function.arguments };
        });
        const rawUsage = body.usage === undefined ? {} : body.usage;
        if (!record(rawUsage)) throw new Error();
        const count = (value: unknown): number => {
          if (value === undefined) return 0;
          if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
            throw new Error();
          return value;
        };
        const promptDetails = rawUsage.prompt_tokens_details;
        const completionDetails = rawUsage.completion_tokens_details;
        if (
          (promptDetails != null && !record(promptDetails)) ||
          (completionDetails != null && !record(completionDetails))
        )
          throw new Error();
        // reasoning_content is intentionally ignored and never returned to orchestration/client.
        return {
          content,
          toolCalls,
          usage: {
            inputTokens: count(rawUsage.prompt_tokens),
            outputTokens: count(rawUsage.completion_tokens),
            cachedInputTokens: count(
              record(promptDetails) ? promptDetails.cached_tokens : undefined,
            ),
            reasoningTokens: count(
              record(completionDetails) ? completionDetails.reasoning_tokens : undefined,
            ),
          },
        };
      } catch {
        throw new Error("Chat provider unavailable");
      }
    },
  };
}
