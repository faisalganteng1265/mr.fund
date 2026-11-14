/**
 * Standalone HTTP server for the chat and position endpoints, so the API can run on its own host
 * while the web app is deployed elsewhere. It only adapts Node's HTTP types to the `Request` to
 * `Response` handlers in `@mrfund/server`; it adds no logic of its own except routing and CORS.
 *
 * Permission boundary: the endpoints are public. Browsers call them cross-origin, so there is no
 * shared secret to hold; the existing per-IP and per-account rate limits are the only admission
 * control, and `Access-Control-Allow-Origin` is not an access control (any non-browser client can
 * call the API). Public reads and unsigned drafts only; nothing here can sign or send.
 * Does not guarantee: who calls it, or protection of the model credential from abuse.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

type Handler = (request: Request) => Promise<Response>;

export interface ApiServerOptions {
  /** Pathname to handler. Anything else is a 404. */
  routes: Readonly<Record<string, Handler>>;
  /** Value of `Access-Control-Allow-Origin`; `*` allows every origin. */
  corsOrigin: string;
}

const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_HEADERS = "content-type";

function toRequest(req: IncomingMessage, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers))
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  const method = req.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { method, headers, signal };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as unknown as ReadableStream;
    init.duplex = "half";
  }
  return new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, init);
}

async function send(res: ServerResponse, response: Response, cors: Record<string, string>) {
  const headers: Record<string, string> = { ...cors };
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  res.writeHead(response.status, headers);
  if (!response.body) return res.end();
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((r) => res.once("drain", r));
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

export function createApiServer(options: ApiServerOptions): Server {
  const cors = {
    "access-control-allow-origin": options.corsOrigin,
    "access-control-allow-methods": CORS_METHODS,
    "access-control-allow-headers": CORS_HEADERS,
    "access-control-max-age": "600",
    vary: "origin",
  };
  return createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      const handler = Object.hasOwn(options.routes, path) ? options.routes[path] : undefined;
      if (!handler) return send(res, new Response("Not found", { status: 404 }), cors);
      if (req.method === "OPTIONS") return send(res, new Response(null, { status: 204 }), cors);
      // A closed connection cancels the turn, like a closed browser tab on the Next route.
      const aborted = new AbortController();
      res.once("close", () => aborted.abort());
      try {
        await send(res, await handler(toRequest(req, aborted.signal)), cors);
      } catch {
        if (!res.headersSent) await send(res, new Response("Unavailable", { status: 503 }), cors);
        else res.end();
      }
    })();
  });
}
