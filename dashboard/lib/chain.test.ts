import { describe, it, expect, vi, afterEach } from 'vitest';
import { liveBalanceMotes } from './chain';

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
