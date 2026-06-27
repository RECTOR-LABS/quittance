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
