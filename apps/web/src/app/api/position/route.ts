import { createPositionRoute } from "@mrfund/server/position";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createPositionRoute(process.env);
const route = (request: Request): Promise<Response> => handle(request);
export const GET = route;
export const POST = route;
export const PUT = route;
export const PATCH = route;
export const DELETE = route;
export const HEAD = route;
export const OPTIONS = route;
