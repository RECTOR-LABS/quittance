import { describe, it, expect } from 'vitest';
import { getAsset, getCycles, verifierRegistryFromCommitted, distributionReceiptForCycle } from './data';

describe('data ledger', () => {
  it('loads the asset config', () => {
    const a = getAsset();
    expect(a.assetId).toBe('inv-001');
    expect(a.quorumRequired).toBe(2);
    expect(a.holders).toHaveLength(2);
    expect(a.holders[0].weightPct + a.holders[1].weightPct).toBe(100);
    expect(a.verifiers).toHaveLength(3);
  });
  it('loads cycles with derived quorum matching verdicts', () => {
    const cycles = getCycles();
    const happy = cycles.find((c) => c.cycleId === 'happy2')!;;
    const fraud = cycles.find((c) => c.cycleId === 'fraud')!;
    expect(happy.quorum.yesCount).toBe(happy.verdicts.filter((v) => v.verdict === 'yes').length);
    expect(happy.quorum.met).toBe(true);
    expect(happy.status).toBe('distributed');
    expect(fraud.quorum.met).toBe(false);
    expect(fraud.status).toBe('halted');
    expect(fraud.distributeTx).toBeUndefined();
  });
});

describe('verifierRegistryFromCommitted (SPEC-6)', () => {
  it('scores only the distributed cycle (halted cycles don\u0027t score)', () => {
    const asset = getAsset();
    const cycles = getCycles();
    const reputation = verifierRegistryFromCommitted(asset, cycles);
    expect(reputation).toHaveLength(3);
    // The happy cycle (3 yes) settles -> every verifier seen+1, voted+1, agreed+1.
    // The fraud cycle (1 yes / 2 no) halts -> contributes nothing (SPEC-6 §7).
    for (const r of reputation) {
      expect(r.cyclesSeen).toBe(1); // only the happy cycle scored
      expect(r.cyclesVoted).toBe(1);
      expect(r.cyclesAgreed).toBe(1);
      expect(r.lastVerdict).toBe('yes'); // the happy cycle's verdict
      expect(r.lastCycle).toBe('happy2');
    }
  });
});

describe('distributionReceiptForCycle reputation snapshot (SPEC-6)', () => {
  it('happy cycle snapshot is pre-increment (zero — first distributed cycle)', () => {
    const asset = getAsset();
    const cycles = getCycles();
    const happy = cycles.find((c) => c.cycleId === 'happy2')!;
    const receipt = distributionReceiptForCycle(happy, asset, cycles);
    expect(receipt.reputationSnapshot).toHaveLength(3);
    for (const s of receipt.reputationSnapshot) {
      expect(s.cyclesSeen).toBe(0); // no prior distributed cycles
      expect(s.cyclesVoted).toBe(0);
      expect(s.cyclesAgreed).toBe(0);
    }
  });
});
