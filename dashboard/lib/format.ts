const MOTES_PER_CSPR = 1_000_000_000n;

export function motesToCspr(motes: string | bigint): string {
  const m = typeof motes === 'bigint' ? motes : BigInt(motes);
  const whole = m / MOTES_PER_CSPR;
  const frac = m % MOTES_PER_CSPR;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (frac === 0n) return wholeStr;
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
  return `${wholeStr}.${fracStr}`;
}

export function truncateHash(hex: string, head = 8, tail = 6): string {
  if (hex.length <= head + tail) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

const BASE = 'https://testnet.cspr.live';
export const deployUrl = (hash: string) => `${BASE}/deploy/${hash}`;
export const accountUrl = (publicKeyHex: string) => `${BASE}/account/${publicKeyHex}`;
export const contractUrl = (packageHash: string) => `${BASE}/contract-package/${packageHash}`;
