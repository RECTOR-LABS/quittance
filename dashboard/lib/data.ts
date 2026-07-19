import asset from '../data/asset.json';
import cycles from '../data/cycles.json';
import type { AssetConfig, Cycle, DistributionReceipt, VerifierReputation, VerifierScoreSnapshot } from './types';

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
 *
 * SPEC-6: `reputationSnapshot` is the **pre-increment** track record each
 * verifier brought to this settlement — i.e. the reputation accumulated from
 * distributed cycles occurring *before* this one in the ledger order
 * (matching the contract's pre-increment semantics). Halted cycles contribute
 * nothing (SPEC-6 §7 — halted cycles don't score).
 */
export function distributionReceiptForCycle(cycle: Cycle, asset: AssetConfig, allCycles: Cycle[] = []): DistributionReceipt {
  const payouts = cycle.payouts ?? [];
  const total = payouts.reduce((s, p) => s + BigInt(p.motes), 0n);
  const funded = BigInt(asset.pool.fundedMotes);
  const yes = cycle.verdicts.filter((v) => v.verdict === 'yes');
  // Pre-increment reputation snapshot: score every distributed cycle that
  // comes BEFORE this one in the ledger order.
  const priorIndex = allCycles.findIndex((c) => c.cycleId === cycle.cycleId);
  const priorDistributed = priorIndex >= 0 ? allCycles.slice(0, priorIndex).filter((c) => c.status === 'distributed') : [];
  const reputationSnapshot: VerifierScoreSnapshot[] = asset.verifiers.map((v) => {
    let seen = 0, voted = 0, agreed = 0;
    for (const c of priorDistributed) {
      seen += 1;
      const verdict = c.verdicts.find((x) => x.source === v.label);
      if (verdict) {
        voted += 1;
        if (verdict.verdict === 'yes') agreed += 1;
      }
    }
    return { signer: v.label, cyclesSeen: seen, cyclesVoted: voted, cyclesAgreed: agreed };
  });
  return {
    assetId: asset.assetId,
    cycleId: cycle.cycleId,
    totalDistributedMotes: total.toString(),
    dustRetainedMotes: funded > total ? (funded - total).toString() : '0',
    holderCount: payouts.length,
    quorumRequired: cycle.quorum.required,
    signers: yes.map((v) => v.signer),
    verdictHashes: yes.map((v) => v.signature),
    reputationSnapshot,
    verifyTx: cycle.distributeTx,
  };
}

/**
 * Derive the verifier reputation registry (SPEC-6) from committed cycle data —
 * the honest fallback the dashboard shows until the live on-chain read
 * (`liveVerifierRegistry`) is wired at the bundled deploy. Scores ONLY
 * distributed cycles: halted cycles revert before any state write, so they
 * contribute nothing (SPEC-6 §7 — the contract cannot authoritatively
 * establish ground truth without settlement). This is exactly the on-chain
 * model applied to the committed ledger.
 */
export function verifierRegistryFromCommitted(asset: AssetConfig, cycles: Cycle[]): VerifierReputation[] {
  return asset.verifiers.map((v) => {
    let cyclesSeen = 0, cyclesVoted = 0, cyclesAgreed = 0;
    let lastVerdict: 'yes' | 'no' | null = null;
    let lastCycle: string | null = null;
    for (const c of cycles) {
      if (c.status !== 'distributed') continue; // halted → no scoring
      cyclesSeen += 1;
      const verdict = c.verdicts.find((x) => x.source === v.label);
      if (verdict) {
        cyclesVoted += 1;
        lastVerdict = verdict.verdict;
        lastCycle = c.cycleId;
        if (verdict.verdict === 'yes') cyclesAgreed += 1;
      }
    }
    return { signer: v.label, pubkeyHex: v.publicKeyHex, cyclesSeen, cyclesVoted, cyclesAgreed, lastVerdict, lastCycle };
  });
}
