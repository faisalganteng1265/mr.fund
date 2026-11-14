import { createChatRoute, createPositionRoute } from "@mrfund/server";
import { createApiServer } from "./server";

const env = process.env;
const port = /^[1-9][0-9]{0,4}$/.test(env.API_PORT ?? "") ? Number(env.API_PORT) : 8787;
const host = env.API_HOST || "0.0.0.0";

createApiServer({
  routes: {
    "/api/chat": createChatRoute(env),
    "/api/position": createPositionRoute(env),
  },
  corsOrigin: env.API_CORS_ORIGIN || "*",
}).listen(port, host, () => {
  process.stdout.write(`mrfund api listening on ${host}:${port}\n`);
});
