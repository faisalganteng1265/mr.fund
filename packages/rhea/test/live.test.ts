import { healthBps } from "@mrfund/engine";
import { expect, it } from "vitest";
import { createRheaClient, readPosition } from "../src/index";

// Opt-in only: public read-only RPC, no wallet, keys or transaction submission.
it.skipIf(process.env.RHEA_LIVE_READ !== "1")(
  "reads a real public mainnet position",
  async () => {
    const result = await readPosition(
      createRheaClient("https://free.rpc.fastnear.com"),
      { network: "mainnet", lendingId: "contract.main.burrow.near" },
      "brianphan01.near",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const health = healthBps(result.value, Date.now());
    expect(health.ok).toBe(true);
    console.log(
      JSON.stringify({
        network: result.value.network,
        accountId: result.value.accountId,
        blockHeight: result.value.blockHeight,
        readAtMs: result.value.readAtMs,
        health: health.ok ? health.value : health.error,
      }),
    );
  },
  60_000,
);
