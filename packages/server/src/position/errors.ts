export const positionErrors = {
  invalid_input: [400, "Use exactly one valid accountId and networkId selector."],
  network_mismatch: [409, "Match the account and selected network to this server's network."],
  no_position: [404, "No nonzero lending position was found. Check the selected account."],
  rpc_unavailable: [503, "NEAR could not be reached. Try reading the position again."],
  configuration_unavailable: [503, "Position reads are not configured. Contact the operator."],
  stale_data: [422, "Position or price data is too old. Refresh before using risk numbers."],
  untrusted_data: [502, "Position data could not be validated. Try again or contact the operator."],
  unsupported_protocol_version: [
    422,
    "This lending version is not supported. Contact the operator.",
  ],
  timeout: [504, "The position read timed out. Try again."],
  cancelled: [499, "The position read was cancelled. Start a new read."],
  request_too_large: [413, "Reduce the request body or query size and try again."],
  invalid_content_type: [415, "Send the POST body as application/json."],
  rate_limited: [429, "Too many position reads. Wait before trying again."],
  method_not_allowed: [405, "Use GET or POST to read a position."],
} as const;
export type PositionErrorCode = keyof typeof positionErrors;
export function positionError(
  code: PositionErrorCode,
  networkId: "testnet" | "mainnet" | null,
  headers: Record<string, string> = {},
): Response {
  const [status, message] = positionErrors[code];
  return Response.json(
    { ok: false, error: { code, message }, networkId },
    { status, headers: { "cache-control": "no-store", ...headers } },
  );
}
