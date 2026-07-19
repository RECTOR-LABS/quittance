import { describe, it, expect, vi, afterEach } from 'vitest';
import { liveBalanceMotes, liveDistributionReceipt, liveVerifierRegistry } from './chain';

afterEach(() => vi.restoreAllMocks());

describe('liveBalanceMotes', () => {
  it('returns the balance on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result: { balance: '7000000000' } }) })));
    expect(await liveBalanceMotes('01ea')).toBe('7000000000');
  });
  it('returns null on RPC error (graceful fallback)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'boom' } }) })));
    expect(await liveBalanceMotes('01ea')).toBeNull();
  });
  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect(await liveBalanceMotes('01ea')).toBeNull();
  });
});

describe('liveVerifierRegistry (SPEC-6)', () => {
  // NOTE: on-chain CLValue decode wires at the bundled deploy. Until then the
  // reader returns null gracefully so the UI falls back to the committed-ledger
  // reputation (`verifierRegistryFromCommitted`). These tests pin that fallback.
  it('returns null gracefully (on-chain decode wires at the bundled deploy)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result: { parsed: { cl_type: 'Vec', bytes: '00' } } }) })));
    expect(await liveVerifierRegistry('hash-abc')).toBeNull();
  });
  it('returns null on RPC error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'boom' } }) })));
    expect(await liveVerifierRegistry('hash-abc')).toBeNull();
  });
  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect(await liveVerifierRegistry('hash-abc')).toBeNull();
  });
});

describe('liveDistributionReceipt', () => {
  // NOTE: on-chain CLValue decode wires at T9 (receipt-bearing contract
  // deployed). Until then the reader returns null gracefully so the UI falls
  // back to the committed-ledger receipt. These tests pin that fallback.
  it('returns null gracefully (on-chain decode wires at T9)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result: { parsed: { cl_type: 'Map', bytes: '00' } } }) })));
    expect(await liveDistributionReceipt('hash-abc', 'inv-1', 'happy')).toBeNull();
  });
  it('returns null on RPC error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'boom' } }) })));
    expect(await liveDistributionReceipt('hash-abc', 'inv-1', 'happy')).toBeNull();
  });
  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect(await liveDistributionReceipt('hash-abc', 'inv-1', 'happy')).toBeNull();
  });
});
