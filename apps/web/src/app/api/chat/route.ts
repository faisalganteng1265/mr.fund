import { createChatRoute } from "@mrfund/server/chat";

export const runtime = "nodejs";

const handle = createChatRoute(process.env);

/** Same-origin fallback; production points the browser at the API server instead. */
export const POST = (request: Request): Promise<Response> => handle(request);
