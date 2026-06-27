import { describe, it, expect } from 'vitest';
import { getAsset, getCycles } from './data';

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
    const happy = cycles.find((c) => c.cycleId === 'happy')!;
    const fraud = cycles.find((c) => c.cycleId === 'fraud')!;
    expect(happy.quorum.yesCount).toBe(happy.verdicts.filter((v) => v.verdict === 'yes').length);
    expect(happy.quorum.met).toBe(true);
    expect(happy.status).toBe('distributed');
    expect(fraud.quorum.met).toBe(false);
    expect(fraud.status).toBe('halted');
    expect(fraud.distributeTx).toBeUndefined();
  });
});
