import type { ChatEvent } from "@mrfund/agent";
import { apiUrl } from "./apiBase";
import type { LiveChatRequest } from "./liveChatRequest";

export type ChatFailure =
  | "invalid_request"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "interrupted"
  | "invalid_stream";

export class LiveChatError extends Error {
  constructor(readonly code: ChatFailure) {
    super(code);
  }
}

/** POST SSE client. Aborting a turn prevents delivery of any later event. */
export async function* streamLiveChat(
  request: LiveChatRequest,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): AsyncIterable<ChatEvent> {
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetcher(apiUrl("/api/chat"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    signal.throwIfAborted();
    throw new LiveChatError("unavailable");
  }
  signal.throwIfAborted();
  if (!response.ok)
    throw new LiveChatError(
      response.status === 400
        ? "invalid_request"
        : response.status === 429
          ? "rate_limited"
          : "unavailable",
    );
  if (!response.body) throw new LiveChatError("interrupted");
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  try {
    while (!done) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      while (true) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary) break;
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const lines = frame.split(/\r?\n/);
        const eventName = lines
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim();
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        if (
          eventName &&
          !["message", "progress", "text", "card", "error", "done"].includes(eventName)
        )
          continue;
        let value: unknown;
        try {
          value = JSON.parse(data);
        } catch {
          throw new LiveChatError("invalid_stream");
        }
        if (!value || typeof value !== "object" || !("type" in value))
          throw new LiveChatError("invalid_stream");
        const type = value.type;
        if (
          typeof type !== "string" ||
          !["progress", "text", "card", "error", "done"].includes(type)
        )
          continue;
        signal.throwIfAborted();
        yield value as ChatEvent;
        if (type === "done") {
          done = true;
          break;
        }
      }
      if (chunk.done) break;
    }
    if (!done) throw new LiveChatError("interrupted");
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof LiveChatError) throw error;
    throw new LiveChatError("interrupted");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
