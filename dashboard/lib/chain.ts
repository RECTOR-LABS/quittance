import type { DistributionReceipt } from './types';

const RPC_URL = process.env.CASPER_NODE_URL ?? 'https://node.testnet.casper.network/rpc';

/**
 * Reads an account's current main-purse balance (motes) from the public node.
 * Read-only, no secrets. Returns null on any failure so callers can fall back
 * to the committed ledger value rather than crash the page.
 */
export async function liveBalanceMotes(publicKeyHex: string): Promise<string | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'query_balance',
        params: { purse_identifier: { main_purse_under_public_key: publicKeyHex } },
      }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    const balance = json?.result?.balance;
    return typeof balance === 'string' ? balance : null;
  } catch {
    return null;
  }
}

/**
 * Reads the on-chain distribution receipt (SPEC-1) for a settled cycle from the
 * vault contract via `query_state`. SDK-free raw RPC like `liveBalanceMotes`.
 *
 * NOTE (T9 wiring): the stored `Receipt` is a typed CLValue struct; full
 * on-chain CLValue decode is wired once the receipt-bearing contract is
 * deployed (SPEC-1 T9). Until then this returns null gracefully so the UI
 * falls back to the committed-ledger receipt — same philosophy as the balance
 * read. Read-only, no secrets.
 */
export async function liveDistributionReceipt(
  contractHash: string,
  assetId: string,
  cycleId: string,
): Promise<DistributionReceipt | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'query_state',
        params: {
          key: contractHash,
          path: ['receipts', `${assetId}:${cycleId}`],
        },
      }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error || !json?.result) return null;
    // CLValue decode wires at T9 (receipt-bearing contract deployed). Until then,
    // treat any non-decodable response as "not yet available" → graceful null.
    return null;
  } catch {
    return null;
  }
}
