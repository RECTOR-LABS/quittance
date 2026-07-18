import asset from '../data/asset.json';
import cycles from '../data/cycles.json';
import type { AssetConfig, Cycle, DistributionReceipt } from './types';

export function getAsset(): AssetConfig {
  const a = asset as AssetConfig;
  const sum = a.holders.reduce((s, h) => s + h.weightPct, 0);
  if (sum !== 100) throw new Error(`asset.json holder weights sum to ${sum}, expected 100`);
  return a;
}

export function getCycles(): Cycle[] {
  const list = cycles as Cycle[];
  for (const c of list) {
    const yes = c.verdicts.filter((v) => v.verdict === 'yes').length;
    if (yes !== c.quorum.yesCount) throw new Error(`cycle ${c.cycleId}: quorum.yesCount ${c.quorum.yesCount} != ${yes} yes-verdicts`);
    if (c.quorum.met !== yes >= c.quorum.required) throw new Error(`cycle ${c.cycleId}: quorum.met inconsistent`);
    if (c.quorum.met && c.status !== 'distributed') throw new Error(`cycle ${c.cycleId}: met but not distributed`);
    if (!c.quorum.met && c.status !== 'halted') throw new Error(`cycle ${c.cycleId}: not met but not halted`);
  }
  return list;
}

/**
 * Derive a displayable `DistributionReceipt` (SPEC-1) from committed cycle data.
 * Used by the UI until the live on-chain read (`liveDistributionReceipt`) is
 * wired at T9 (receipt-bearing contract deployed). Mirrors the contract's
 * stored `Receipt` shape.
 */
export function distributionReceiptForCycle(cycle: Cycle, asset: AssetConfig): DistributionReceipt {
  const payouts = cycle.payouts ?? [];
  const total = payouts.reduce((s, p) => s + BigInt(p.motes), 0n);
  const funded = BigInt(asset.pool.fundedMotes);
  const yes = cycle.verdicts.filter((v) => v.verdict === 'yes');
  return {
    assetId: asset.assetId,
    cycleId: cycle.cycleId,
    totalDistributedMotes: total.toString(),
    dustRetainedMotes: funded > total ? (funded - total).toString() : '0',
    holderCount: payouts.length,
    quorumRequired: cycle.quorum.required,
    signers: yes.map((v) => v.signer),
    verdictHashes: yes.map((v) => v.signature),
    verifyTx: cycle.distributeTx,
  };
}
