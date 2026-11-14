import { describe, expect, it } from "vitest";
import { createNearAIProvider } from "../src/chat/provider";

const input = {
  messages: [{ role: "user" as const, content: "Hello" }],
  tools: [],
  signal: new AbortController().signal,
};
const completion = {
  choices: [
    {
      message: {
        content: null,
        tool_calls: [
          { id: "call-a", type: "function", function: { name: "get_position", arguments: "{}" } },
        ],
      },
    },
  ],
  usage: {
    prompt_tokens: 11,
    completion_tokens: 4,
    prompt_tokens_details: { cached_tokens: 3 },
    completion_tokens_details: { reasoning_tokens: 2 },
  },
};

describe("NEAR AI native provider", () => {
  it("maps compatible messages, tools, call ids and usage without exposing credentials", async () => {
    let request: RequestInit | undefined;
    let url = "";
    const provider = createNearAIProvider({
      apiKey: "private-key",
      model: "z-ai/glm-5.3-flash",
      fetchImpl: async (target, init) => {
        url = String(target);
        request = init;
        return Response.json(completion);
      },
    });
    const reply = await provider.complete({
      ...input,
      messages: [
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "earlier", name: "explain_term", arguments: "{}" }],
        },
        { role: "tool", content: "explanation", toolCallId: "earlier" },
      ],
      tools: [
        {
          name: "get_position",
          description: "Read",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
    });
    expect(url).toBe("https://cloud-api.near.ai/v1/chat/completions");
    const body = JSON.parse(String(request?.body));
    expect(body.messages[1]).toEqual({
      role: "tool",
      content: "explanation",
      tool_call_id: "earlier",
    });
    expect(body.messages[0].tool_calls[0].function.name).toBe("explain_term");
    expect(body.tools[0].function.name).toBe("get_position");
    expect(reply).toEqual({
      content: "",
      toolCalls: [{ id: "call-a", name: "get_position", arguments: "{}" }],
      usage: { inputTokens: 11, outputTokens: 4, cachedInputTokens: 3, reasoningTokens: 2 },
    });
  });
  it("accepts nullable optional usage details from the live gateway", async () => {
    const provider = createNearAIProvider({
      apiKey: "key",
      model: "z-ai/glm-5.3-flash",
      fetchImpl: async () =>
        Response.json({
          choices: [{ message: { content: "I can explain your position." } }],
          usage: {
            prompt_tokens: 193,
            completion_tokens: 6,
            prompt_tokens_details: null,
            completion_tokens_details: { reasoning_tokens: 1 },
          },
        }),
    });
    const reply = await provider.complete(input);
    expect(reply.content).toBe("I can explain your position.");
    expect(reply.usage).toEqual({
      inputTokens: 193,
      outputTokens: 6,
      cachedInputTokens: 0,
      reasoningTokens: 1,
    });
  });
  it.each([
    "https://evil.example/v1",
    "http://cloud-api.near.ai/v1",
    "https://cloud-api.near.ai@evil.example/v1",
    "https://cloud-api.near.ai/v1?secret=x",
  ])("rejects credential destination %s before fetch", (baseUrl) => {
    expect(() => createNearAIProvider({ apiKey: "private-key", model: "model", baseUrl })).toThrow(
      /configuration/i,
    );
  });
  it("bounds response bytes and cancels the response reader", async () => {
    let cancelled = false;
    const provider = createNearAIProvider({
      apiKey: "key",
      model: "model",
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(600_000));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    });
    await expect(provider.complete(input)).rejects.toThrow(/unavailable/i);
    expect(cancelled).toBe(true);
  });
  it("sanitizes provider HTTP errors and never logs response content", async () => {
    const provider = createNearAIProvider({
      apiKey: "private-key",
      model: "model",
      fetchImpl: async () => new Response("private-key prompt contents", { status: 401 }),
    });
    await expect(provider.complete(input)).rejects.toThrow(/^Chat provider unavailable$/);
  });
  it("refuses malformed provider tool calls rather than returning an unsafe cast", async () => {
    const provider = createNearAIProvider({
      apiKey: "key",
      model: "model",
      fetchImpl: async () =>
        Response.json({ choices: [{ message: { content: "ok", tool_calls: [{ id: 12 }] } }] }),
    });
    await expect(provider.complete(input)).rejects.toThrow(/unavailable/i);
  });
  it("propagates cancellation into native fetch", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | null | undefined;
    // ES2022 test target has no Promise.withResolvers.
    const provider = createNearAIProvider({
      apiKey: "key",
      model: "model",
      fetchImpl: async (_url, init) => {
        seen = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("secret")), {
            once: true,
          });
        });
      },
    });
    const pending = provider.complete({ ...input, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/unavailable/i);
    expect(seen?.aborted).toBe(true);
  });
});
