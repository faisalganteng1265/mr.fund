import {
  type ChatEvent,
  type ChatProvider,
  type ConversationMessage,
  runChatTurn,
  type ToolContext,
  type TurnSummary,
} from "@mrfund/agent";
import { isValidAccountId } from "@mrfund/shared";
import { createAdmission, edgeIp, type ProxyConfig, type RateLimit } from "../admission";
import { abortable, readBoundedBody, record } from "../transport";

/** The account is a public-read selector, never an authenticated/signed-in identity. */
export interface ChatRequest {
  message: string;
  accountId: string;
  locale?: "en" | "id" | "es";
  history?: ConversationMessage[];
  guardianId?: string;
}
export interface ChatHandlerDependencies {
  provider?: ChatProvider;
  loadContext: (input: ChatRequest, signal: AbortSignal) => Promise<ToolContext>;
  rateLimit?: RateLimit;
  proxy?: ProxyConfig;
}
function parseRequest(value: unknown): ChatRequest {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !["message", "accountId", "locale", "history", "guardianId"].includes(key),
    ) ||
    typeof value.message !== "string" ||
    !value.message.trim() ||
    value.message.length > 4000 ||
    typeof value.accountId !== "string" ||
    !isValidAccountId(value.accountId) ||
    (value.guardianId !== undefined &&
      (typeof value.guardianId !== "string" || !isValidAccountId(value.guardianId))) ||
    (value.locale !== undefined && !["en", "id", "es"].includes(String(value.locale)))
  )
    throw new Error("Invalid request");
  const history: ConversationMessage[] = [];
  if (value.history !== undefined) {
    if (!Array.isArray(value.history) || value.history.length > 20)
      throw new Error("Invalid history");
    let length = 0;
    for (const message of value.history) {
      if (
        !record(message) ||
        Object.keys(message).some((key) => !["role", "content"].includes(key)) ||
        (message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string" ||
        message.content.length > 4000
      )
        throw new Error("Invalid history");
      length += message.content.length;
      if (length > 16_000) throw new Error("Invalid history");
      history.push({ role: message.role, content: message.content });
    }
  }
  return {
    message: value.message,
    accountId: value.accountId,
    ...(value.locale === undefined ? {} : { locale: value.locale as "en" | "id" | "es" }),
    ...(value.guardianId === undefined ? {} : { guardianId: value.guardianId as string }),
    ...(value.history === undefined ? {} : { history }),
  };
}

export type ChatHandler = (request: Request) => Promise<Response>;

export function createChatHandler(dependencies: ChatHandlerDependencies): ChatHandler {
  const limit = dependencies.rateLimit ?? { requests: 10, windowMs: 60_000, maxEntries: 4096 };
  const allow = createAdmission(limit);
  return async (request) => {
    const started = Date.now();
    const turnId = crypto.randomUUID();
    let finished = false;
    const timing = (
      stage: "context" | "provider" | "repair" | "total",
      since: number,
      round?: number,
    ) =>
      console.info({
        event: "chat_timing",
        turnId,
        stage,
        elapsedMs: Math.max(0, Date.now() - since),
        ...(round === undefined ? {} : { round }),
      });
    async function measured<T>(
      stage: "context" | "provider" | "repair",
      work: () => Promise<T>,
      round?: number,
    ): Promise<T> {
      const since = Date.now();
      try {
        return await abortable(work(), controller.signal);
      } finally {
        timing(stage, since, round);
      }
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 60_000);
    const disconnect = () => controller.abort();
    request.signal.addEventListener("abort", disconnect, { once: true });
    if (request.signal.aborted) disconnect();
    const cleanup = () => {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", disconnect);
      if (!finished) {
        finished = true;
        timing("total", started);
      }
    };
    const httpError = (status: number, code: string) => {
      cleanup();
      return Response.json({ error: code }, { status, headers: { "cache-control": "no-store" } });
    };
    // Charge the authoritative transport bucket before parsing: malformed or slow bodies cost quota.
    if (!allow([`ip:${edgeIp(request, dependencies.proxy)}`]))
      return httpError(429, "rate_limited");
    let input: ChatRequest;
    try {
      if (request.method !== "POST") return httpError(405, "method_not_allowed");
      if (
        request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return httpError(415, "invalid_content_type");
      const raw = await readBoundedBody(request.body, 32_768, controller.signal);
      input = parseRequest(JSON.parse(raw) as unknown);
    } catch (error) {
      return httpError(
        timedOut ? 408 : request.signal.aborted ? 499 : error instanceof RangeError ? 413 : 400,
        timedOut ? "timeout" : request.signal.aborted ? "cancelled" : "invalid_request",
      );
    }
    if (!allow([`account:${input.accountId}`])) return httpError(429, "rate_limited");
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(output) {
        let bytes = 0;
        const emit = (event: ChatEvent, terminal = false) => {
          if (closed || request.signal.aborted) return;
          const chunk = new TextEncoder().encode(
            `data: ${JSON.stringify(event, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value))}\n\n`,
          );
          if (bytes + chunk.byteLength > (terminal ? 1_000_000 : 990_000))
            throw new Error("Response limit");
          bytes += chunk.byteLength;
          output.enqueue(chunk);
        };
        const execute = async () => {
          try {
            emit({ type: "progress", stage: "reading" });
            if (!dependencies.provider) throw new Error("Unavailable");
            const context = await measured("context", () =>
              dependencies.loadContext(input, controller.signal),
            );
            controller.signal.throwIfAborted();
            let round = 0;
            const provider = dependencies.provider;
            await abortable(
              runChatTurn({
                message: input.message,
                ...(input.history === undefined ? {} : { history: input.history }),
                ...(input.locale === undefined ? {} : { locale: input.locale }),
                context,
                provider: {
                  complete: (call) =>
                    measured(
                      call.messages.at(-1)?.role === "system" ? "repair" : "provider",
                      () => provider.complete(call),
                      ++round,
                    ),
                },
                signal: controller.signal,
                emit,
              }),
              controller.signal,
            );
            controller.signal.throwIfAborted();
          } catch {
            if (!closed && !request.signal.aborted) {
              const status = timedOut
                ? "timeout"
                : controller.signal.aborted
                  ? "cancelled"
                  : "unavailable";
              const summary: TurnSummary = {
                via: "template",
                guardHits: 0,
                toolCalls: 0,
                providerCalls: 0,
                elapsedMs: Math.max(0, Date.now() - started),
                usage: {
                  inputTokens: 0,
                  outputTokens: 0,
                  cachedInputTokens: 0,
                  reasoningTokens: 0,
                },
                status,
              };
              const text =
                input.locale === "id"
                  ? "Mr.Fund belum dapat berbicara sekarang. Silakan coba lagi."
                  : input.locale === "es"
                    ? "Mr.Fund no puede hablar ahora. Inténtalo de nuevo."
                    : "Mr.Fund can't talk right now. Please try again.";
              // Fixed nonnumeric text only; never echo provider/RPC errors, credentials or transcripts.
              emit({ type: "error", code: status }, true);
              emit({ type: "text", text }, true);
              emit({ type: "done", summary }, true);
            }
          } finally {
            cleanup();
            if (!closed) {
              closed = true;
              output.close();
            }
          }
        };
        void execute();
      },
      cancel() {
        closed = true;
        controller.abort();
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  };
}
