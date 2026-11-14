/**
 * The position endpoint handler wired from environment variables. It imports no chat, model or
 * signing code (checked by `position-dependencies.test.ts`).
 */
import { readProxyConfig } from "./admission";
import { readPositionConfig } from "./position/config";
import { createPositionHandler, type PositionHandler } from "./position/handler";

type Env = Readonly<Record<string, string | undefined>>;

export function createPositionRoute(env: Env): PositionHandler {
  let handler: PositionHandler | undefined;
  return (request) => {
    const proxy = readProxyConfig(env);
    handler ??= createPositionHandler({
      ...(proxy ? { proxy } : {}),
      config: readPositionConfig(env),
      ...(env.MAX_DATA_AGE_MS === undefined
        ? {}
        : {
            maxDataAgeMs: /^[1-9][0-9]*$/.test(env.MAX_DATA_AGE_MS)
              ? Number(env.MAX_DATA_AGE_MS)
              : 0,
          }),
    });
    return handler(request);
  };
}
export type { PositionView } from "./position/presenter";
