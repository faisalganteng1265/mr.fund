import { type FactoryInfo, readGuardian } from "@mrfund/guardian-client";
import { ok } from "@mrfund/shared";
import { NOW, target, views } from "../../../packages/guardian-client/test/fixture";

export { NOW, views };
export const OWNER = "alice.testnet";
export const NEAR = 10n ** 24n;
export const factory: FactoryInfo = {
  factoryId: "factory.testnet",
  minFunding: 2_753_250n * 10n ** 18n,
  maxFunding: 10n * NEAR,
  debtTokenId: "usdc.testnet",
  collateralTokenId: "wrap.testnet",
  lendingId: "rhea.testnet",
  feeRecipientId: "fees.testnet",
  activationFee: 5n,
};
export const policy = {
  maxPerAction: 100n,
  lifetimeCap: 1000n,
  reserveFloor: 20n,
  triggerHfBps: 12_000,
  targetHfBps: 15_000,
  cooldownSec: 300,
  actionFee: 1n,
};

type Views = ReturnType<typeof views>;
/** A validated Guardian snapshot read through the real parser from mutable view data. */
export async function snapshot(over: (v: Views) => void = () => {}, now = NOW) {
  const data = views();
  over(data);
  const r = await readGuardian(
    {
      view: async (_id, method) =>
        ok({
          data: (data as Record<string, unknown>)[method],
          blockHeight: 123,
          blockHash: "block",
        }),
    },
    target,
    { now: () => now },
  );
  if (!r.ok) throw new Error(`fixture: ${r.error.detail}`);
  return r.value;
}

/** A Guardian that exists but is not active yet (status `created`, empty reserve). */
export const createdViews = (v: Views) => {
  v.get_status.status = "created";
  v.get_reserve = {
    reserve: "0",
    floor: "20",
    spendable: "0",
    lifetime_cap: "1000",
    spent_total: "0",
    lifetime_remaining: "1000",
  };
  v.get_history = [];
};
