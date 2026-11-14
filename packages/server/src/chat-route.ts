/**
 * The chat endpoint handler wired from environment variables, shared by the Next route handler
 * and the standalone API server so their configuration cannot drift. Built on the first request;
 * a missing or invalid configuration yields typed unavailable replies from the handler itself,
 * never a default network or credential destination.
 */
import type { ChatProvider } from "@mrfund/agent";
import { readProxyConfig } from "./admission";
import { createContextLoader, readChatConfig } from "./chat/context";
import { type ChatHandler, createChatHandler } from "./chat/handler";
import { createNearAIProvider } from "./chat/provider";

type Env = Readonly<Record<string, string | undefined>>;

/** Public read context and unsigned proposals only; accountId is not wallet authentication. */
export function createChatRoute(env: Env): ChatHandler {
  let handler: ChatHandler | undefined;
  return (request) => {
    if (!handler) {
      const config = readChatConfig(env);
      let provider: ChatProvider | undefined;
      try {
        if (env.NEARAI_API_KEY && env.NEARAI_MODEL)
          provider = createNearAIProvider({
            apiKey: env.NEARAI_API_KEY,
            model: env.NEARAI_MODEL,
            ...(env.NEARAI_BASE_URL ? { baseUrl: env.NEARAI_BASE_URL } : {}),
          });
      } catch {
        // A bad credential destination is unavailable, never a request to an alternative host.
      }
      const proxy = readProxyConfig(env);
      handler = createChatHandler({
        ...(provider ? { provider } : {}),
        loadContext: config
          ? createContextLoader(config)
          : async () => {
              throw new Error("Chat context unavailable");
            },
        ...(proxy ? { proxy } : {}),
      });
    }
    return handler(request);
  };
}
