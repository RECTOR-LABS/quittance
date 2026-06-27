# Quittance Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only Next.js dashboard that visualizes Quittance's proven happy + fraud cycles on `ServicerVault` (casper-test), making "verify, not attest" legible and independently verifiable, deployed on Railway.

**Architecture:** A new `dashboard/` workspace package (`@quittance/dashboard`), Next.js App Router with Server Components. Hybrid data: committed `data/asset.json` + `data/cycles.json` (public identifiers only, reconstructed from the real on-chain runs) read by `lib/data.ts`, merged with live `query_balance` reads from `lib/chain.ts` (graceful fallback). Two routes — Issuer (`/`) and Holder (`/holder`). Every hash deep-links to `testnet.cspr.live/deploy/<hash>`.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS · Lucide React · vitest + @testing-library/react.

## Global Constraints

- Node `>=20`, pnpm `>=10` (root is `pnpm@10.33.2`); package is ESM (`"type": "module"` semantics via Next).
- **GPG-sign every commit** (`git commit -S`, key `BF47B9DC1FA320FA`). **No AI attribution** anywhere.
- **Committed data carries ONLY public identifiers** — public keys, account hashes, contract/package hashes, tx hashes, signatures. **Never** `privHex`, secret keys, or the CSPR.cloud token.
- **Icons:** Lucide React only — no Unicode emoji as UI icons.
- **cspr.live paths (verified 2026-06-27):** transactions are legacy Deploys → `https://testnet.cspr.live/deploy/<hash>`; accounts → `https://testnet.cspr.live/account/<publicKeyHex>`; contract → `https://testnet.cspr.live/contract-package/<packageHash>`.
- **Read-only:** no wallet connect, no on-chain writes, no secret-bearing calls. Sole env var: `CASPER_NODE_URL` (default `https://node.testnet.casper.network/rpc`).
- Tests pass (`pnpm --filter @quittance/dashboard test`), `tsc`/Next build clean, before each commit.

## Reference Data (frozen, from `.superpowers/sdd/progress.md` + key files; public only)

**Vault:** entity `6a6747d294af421c11f62b400167580600329c48bfc9cce3c2a76db42b27e132` · package `fb5225d80e8bc59d7e8581f6be2118e3442ab69eea432d9ad79daf1fbd222d3f` · install deploy `4313f7499d17804a74b38ef9503d18bfd4cbff415606cde5e9fe6e04ef1c4c9e`. Quorum 2-of-3. Expected cashflow `1000000000000` motes (1000 CSPR), reference `INV-001`. Pool funded `10000000000` motes (10 CSPR).

**Agent:** pubkey `0197f3bf29f93fd7e88f3f6b02f68ef5936cb0aa9d0f9ab3f3a84dd8f511b35b94` · account `05454459c91497e073217296bb6b4c9da1bae8019a1790a3f87f4dea3ee524b2`.

**Holders:**
- Holder A — weight 70 — pubHex `ea7f6e28f405f2acdba965e40e64e2004cfffdf671ed10f089d0db880806a016` — casperPublicKey `01ea7f6e28f405f2acdba965e40e64e2004cfffdf671ed10f089d0db880806a016` — accountHash `0c61a1f572e6bb7b2a3cf23b01105897ea10ac8468d395c36f46f6dff4b6179b`.
- Holder B — weight 30 — pubHex `c7c0511eb6d71eadc085842fb7fa28ef56c1a1a38e7355652fc32ce572f63567` — casperPublicKey `01c7c0511eb6d71eadc085842fb7fa28ef56c1a1a38e7355652fc32ce572f63567` — accountHash `48f10c6a95265cd6ba51ececa3b8bb019ca6888451b5e2891e3be3bbe4fbd2a9`.

**Verifiers (pubHex = signer = casperPublicKey minus `01`; payTo = `00` + accountHash):**
- v1 — casperPublicKey `0121423f386b2700fe0cc65a5bb3bbb8dcadfa1dac6abe89b51f23b0af72c72892` — payTo `006851f526df86b7357f5f93a9d4fc1bdacbefc2b0636f9c7cdec5348b91f573b9`.
- v2 — casperPublicKey `01d13c0fd57a9f58046fa4527777d3367350c739bc97eb55a21d6452267da65105` — payTo `003dbead68066ca8752b49f857887efc8f32bc5d034bbab3fc91ca3ca655032475`.
- v3 — casperPublicKey `014970062de460a171b72fd7546ff17efaaceacf1c615a239cb1e254f736566697` — payTo `004e6470804c7f80c18899373969eb4fb555bad6203415b991054ee673b1ba0f21`.

**Happy cycle:** all 3 verdicts `yes` (observed `1000000000000`); distribute deploy `6821e0f3e6b01325965562f964047782dab13d4602b7dae7bc7e67c70ac37829` (SUCCESS); payouts Holder A `7000000000` (7 CSPR), Holder B `3000000000` (3 CSPR). Settle deploys recorded truncated (`bb6520be…`/`e05a3def…`/`8b8f30d7…`) — recovered to full in Task 3.

**Fraud cycle (full, captured this session):** status `halted`, reason `quorum_not_met`, no distribute.
- v1 — verdict `yes`, observed `1000000000000`, signer `21423f386b2700fe0cc65a5bb3bbb8dcadfa1dac6abe89b51f23b0af72c72892`, signature `bc38ccf263b0dcdf140dd1026045f5e4dcc1e32eacdc3125b8b86051eea769642d35e77947c1915c8ef00970907b1733c82f0f10f296b6175a0e0c0d12351d04`, settle `a02b1c7d2ed52ea82ff68740d9b5a65d9716cee8594b482a13d0c27e846d6a7d`.
- v2 — verdict `no`, observed `0`, signer `d13c0fd57a9f58046fa4527777d3367350c739bc97eb55a21d6452267da65105`, signature `d7c1a7068f3224028dceba8e587c8a57a8ad0042c1698c7f3327849aad5fb92851cab673f8631bd7e392a8b1052388bd9ba956974e970df6dac067111ffa9b0a`, settle `40a85e53df987e9af3b3e2261833419de84676245332c5fa8570354b8875df93`.
- v3 — verdict `no`, observed `0`, signer `4970062de460a171b72fd7546ff17efaaceacf1c615a239cb1e254f736566697`, signature `7634e2c4a625eda0ae47fd0860eb9f00dc66a7117201d1ac47b158b569689ace6f4d398920f8b4b3ec6ca58ca80bdda347e0adf5e7a3803d8049778877e2640d`, settle `8a962e502601c27db98a8195ef6c790f18df25f32c56b40306c02d8f5b4115ff`.

---

## File Structure

```
dashboard/
  package.json                 # @quittance/dashboard
  next.config.mjs              # output: 'standalone' for Railway
  tsconfig.json                # Next-generated + workspace-friendly
  vitest.config.mts            # jsdom env, react plugin
  vitest.setup.ts              # @testing-library/jest-dom
  postcss.config.mjs
  tailwind.config.ts
  app/
    globals.css                # Tailwind + dark proof-receipt theme tokens
    layout.tsx                 # shell, nav (Issuer | Holder)
    page.tsx                   # Issuer route (/)
    holder/page.tsx            # Holder route (/holder)
  components/
    TxLink.tsx                 # deploy/account/contract deep links
    VerifierBadge.tsx
    VerdictCard.tsx
    QuorumGate.tsx
    CycleCard.tsx
    AssetHeader.tsx
    HolderRow.tsx
  lib/
    format.ts                  # motes→CSPR, truncateHash, pct, cspr.live URLs
    types.ts                   # AssetConfig, Cycle, Verdict, Receipt
    data.ts                    # load+validate committed ledger
    chain.ts                   # live query_balance + fallback
  data/
    asset.json                 # committed, public identifiers only
    cycles.json                # committed, public identifiers only
  __tests__/                   # vitest (or *.test.ts colocated)
railway.json                   # deploy config (root or dashboard/)
```

---

### Task 1: Scaffold the `@quittance/dashboard` package

**Files:**
- Create: `dashboard/package.json`, `dashboard/next.config.mjs`, `dashboard/tsconfig.json`, `dashboard/postcss.config.mjs`, `dashboard/tailwind.config.ts`, `dashboard/app/globals.css`, `dashboard/app/layout.tsx`, `dashboard/app/page.tsx`

**Interfaces:**
- Produces: a runnable Next.js app at `pnpm --filter @quittance/dashboard dev` (port 3000) showing a placeholder home.

- [ ] **Step 1: Create `dashboard/package.json`**

```json
{
  "name": "@quittance/dashboard",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "15.1.3",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "lucide-react": "^0.469.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.8.3",
    "vitest": "^3.2.3"
  }
}
```

- [ ] **Step 2: Create configs**

`dashboard/next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = { output: 'standalone' };
export default nextConfig;
```

`dashboard/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`dashboard/postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`dashboard/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0e14', panel: '#11161f', edge: '#1d2632',
        yes: '#3fb950', no: '#f85149', accent: '#d63a3a', muted: '#7d8590',
      },
      fontFamily: { mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3: Create the shell**

`dashboard/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
:root { color-scheme: dark; }
body { @apply bg-ink text-gray-100 antialiased; }
```

`dashboard/app/layout.tsx`:
```tsx
import './globals.css';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

export const metadata = { title: 'Quittance — verify, not attest', description: 'Verification-gated servicing for tokenized cashflows on Casper.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="border-b border-edge bg-panel/60">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
            <span className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-accent" /> Quittance</span>
            <Link href="/" className="text-sm text-muted hover:text-gray-100">Issuer</Link>
            <Link href="/holder" className="text-sm text-muted hover:text-gray-100">Holder</Link>
          </div>
        </nav>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
```

`dashboard/app/page.tsx`:
```tsx
export default function Page() {
  return <h1 className="text-2xl font-semibold">Quittance — Issuer (scaffold)</h1>;
}
```

- [ ] **Step 4: Install + run**

Run: `pnpm install` (from repo root) then `pnpm --filter @quittance/dashboard dev`
Expected: dev server on http://localhost:3000 renders the nav + "Issuer (scaffold)".

- [ ] **Step 5: Commit**

```bash
git add dashboard/
git commit -S -m "feat(dashboard): scaffold @quittance/dashboard Next.js app"
```

---

### Task 2: `lib/format.ts` — formatting + cspr.live URL builders

**Files:**
- Create: `dashboard/lib/format.ts`, `dashboard/lib/format.test.ts`

**Interfaces:**
- Produces: `motesToCspr(motes: string|bigint): string`, `truncateHash(hex: string, head?=8, tail?=6): string`, `deployUrl(hash: string): string`, `accountUrl(publicKeyHex: string): string`, `contractUrl(packageHash: string): string`.

- [ ] **Step 1: Write the failing test** — `dashboard/lib/format.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { motesToCspr, truncateHash, deployUrl, accountUrl, contractUrl } from './format';

describe('format', () => {
  it('converts motes to CSPR with trimming', () => {
    expect(motesToCspr('7000000000')).toBe('7');
    expect(motesToCspr('1000000000000')).toBe('1,000');
    expect(motesToCspr('0')).toBe('0');
    expect(motesToCspr(3000000000n)).toBe('3');
  });
  it('truncates hashes', () => {
    expect(truncateHash('a02b1c7d2ed52ea82ff68740d9b5a65d9716cee8594b482a13d0c27e846d6a7d')).toBe('a02b1c7d…6d6a7d');
  });
  it('builds cspr.live urls', () => {
    expect(deployUrl('abc')).toBe('https://testnet.cspr.live/deploy/abc');
    expect(accountUrl('01ea')).toBe('https://testnet.cspr.live/account/01ea');
    expect(contractUrl('fb52')).toBe('https://testnet.cspr.live/contract-package/fb52');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `pnpm --filter @quittance/dashboard test` → FAIL (module not found).

- [ ] **Step 3: Implement** — `dashboard/lib/format.ts`

```ts
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
```

- [ ] **Step 4: Run test to verify it passes** — Run: `pnpm --filter @quittance/dashboard test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/format.ts dashboard/lib/format.test.ts
git commit -S -m "feat(dashboard): formatting + cspr.live url builders"
```

---

### Task 3: Data ledger — recover hashes, `data/*.json`, `lib/types.ts`, `lib/data.ts`

**Files:**
- Create: `dashboard/lib/types.ts`, `dashboard/data/asset.json`, `dashboard/data/cycles.json`, `dashboard/lib/data.ts`, `dashboard/lib/data.test.ts`, `dashboard/scripts/recover-hashes.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: types `Holder`, `Verifier`, `AssetConfig`, `Verdict`, `Receipt`, `Cycle`; `getAsset(): AssetConfig`, `getCycles(): Cycle[]`.

- [ ] **Step 1: Recover the 5 truncated full hashes**

Create `dashboard/scripts/recover-hashes.mjs` (read-only; resolves truncated prefixes to full deploy hashes via CSPR.cloud account-deploy listing; token from repo `.env`, never printed):
```js
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, '../../.env'));
const T = process.env.CSPR_CLOUD_TOKEN;
const AGENT = '05454459c91497e073217296bb6b4c9da1bae8019a1790a3f87f4dea3ee524b2';
const VERIFIERS = {
  'happy-v1': '6851f526df86b7357f5f93a9d4fc1bdacbefc2b0636f9c7cdec5348b91f573b9',
  'happy-v2': '3dbead68066ca8752b49f857887efc8f32bc5d034bbab3fc91ca3ca655032475',
  'happy-v3': '4e6470804c7f80c18899373969eb4fb555bad6203415b991054ee673b1ba0f21',
};
const PREFIX = { register: '0b7f5b22', fund: '88ec8a49', 'happy-v1': 'bb6520be', 'happy-v2': 'e05a3def', 'happy-v3': '8b8f30d7' };
async function listDeploys(acct) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`https://api.testnet.cspr.cloud/accounts/${acct}/deploys?page=${page}&page_size=100&fields=entry_point`, { headers: { Authorization: T } });
    if (!r.ok) break;
    const j = await r.json();
    out.push(...(j.data ?? []));
    if (!j.data?.length) break;
  }
  return out;
}
const agentDeploys = await listDeploys(AGENT);
const find = (list, pfx) => (list.find((d) => (d.deploy_hash || d.transaction_hash || '').startsWith(pfx))?.deploy_hash) ?? null;
const result = { registerTx: find(agentDeploys, PREFIX.register), fundTx: find(agentDeploys, PREFIX.fund) };
for (const [k, acct] of Object.entries(VERIFIERS)) {
  const d = await listDeploys(acct);
  result[k] = find(d, PREFIX[k]);
}
console.log(JSON.stringify(result, null, 2));
```

Run: `node dashboard/scripts/recover-hashes.mjs`
Expected: a JSON object with full 64-char hashes for `registerTx`, `fundTx`, `happy-v1/v2/v3`. **If any value is `null`** (e.g. settle indexed under the facilitator, not the verifier), leave that cycle receipt's `deployHash` as the known truncated value with `linkable: false` (Task 5 renders it as plain text, no link). Record the recovered values for Step 3.

- [ ] **Step 2: Create `lib/types.ts`**

```ts
export interface Holder { label: string; publicKeyHex: string; accountHash: string; weightPct: number; }
export interface Verifier { label: string; publicKeyHex: string; payTo: string; }
export interface AssetConfig {
  assetId: string; reference: string; expectedCashflowMotes: string; narrative: string;
  vault: { entityHash: string; packageHash: string; installTx: string };
  quorumRequired: number;
  pool: { fundedMotes: string; fundTx: string | null };
  registerTx: string | null;
  holders: Holder[]; verifiers: Verifier[];
}
export interface Verdict { source: string; verdict: 'yes' | 'no'; observedAmount: string; signer: string; signature: string; }
export interface Receipt { verifierId: string; deployHash: string; linkable: boolean; }
export interface Payout { holderLabel: string; motes: string; }
export interface Cycle {
  cycleId: 'happy' | 'fraud'; status: 'distributed' | 'halted'; reason?: string;
  verdicts: Verdict[]; receipts: Receipt[];
  quorum: { yesCount: number; required: number; met: boolean };
  distributeTx?: string; payouts?: Payout[];
}
```

- [ ] **Step 3: Create `data/asset.json` and `data/cycles.json`** using the frozen Reference Data above + the Step 1 recovered hashes. `asset.json`:

```json
{
  "assetId": "inv-001",
  "reference": "INV-001",
  "expectedCashflowMotes": "1000000000000",
  "narrative": "An SMB receivable. Investors hold fractions and are repaid when the client's payment is independently verified.",
  "vault": {
    "entityHash": "6a6747d294af421c11f62b400167580600329c48bfc9cce3c2a76db42b27e132",
    "packageHash": "fb5225d80e8bc59d7e8581f6be2118e3442ab69eea432d9ad79daf1fbd222d3f",
    "installTx": "4313f7499d17804a74b38ef9503d18bfd4cbff415606cde5e9fe6e04ef1c4c9e"
  },
  "quorumRequired": 2,
  "pool": { "fundedMotes": "10000000000", "fundTx": "<<recovered: fundTx>>" },
  "registerTx": "<<recovered: registerTx>>",
  "holders": [
    { "label": "Holder A", "publicKeyHex": "01ea7f6e28f405f2acdba965e40e64e2004cfffdf671ed10f089d0db880806a016", "accountHash": "0c61a1f572e6bb7b2a3cf23b01105897ea10ac8468d395c36f46f6dff4b6179b", "weightPct": 70 },
    { "label": "Holder B", "publicKeyHex": "01c7c0511eb6d71eadc085842fb7fa28ef56c1a1a38e7355652fc32ce572f63567", "accountHash": "48f10c6a95265cd6ba51ececa3b8bb019ca6888451b5e2891e3be3bbe4fbd2a9", "weightPct": 30 }
  ],
  "verifiers": [
    { "label": "v1", "publicKeyHex": "0121423f386b2700fe0cc65a5bb3bbb8dcadfa1dac6abe89b51f23b0af72c72892", "payTo": "006851f526df86b7357f5f93a9d4fc1bdacbefc2b0636f9c7cdec5348b91f573b9" },
    { "label": "v2", "publicKeyHex": "01d13c0fd57a9f58046fa4527777d3367350c739bc97eb55a21d6452267da65105", "payTo": "003dbead68066ca8752b49f857887efc8f32bc5d034bbab3fc91ca3ca655032475" },
    { "label": "v3", "publicKeyHex": "014970062de460a171b72fd7546ff17efaaceacf1c615a239cb1e254f736566697", "payTo": "004e6470804c7f80c18899373969eb4fb555bad6203415b991054ee673b1ba0f21" }
  ]
}
```
Replace each `<<recovered: …>>` with the full hash from Step 1 (or `null` if unrecoverable — `lib/data.ts` tolerates `null` and the UI omits the link).

`data/cycles.json` (fraud values are complete above; happy verdicts re-sign deterministically OR set `signature: ""` and render "signed ✓" without the hex — never invent a signature; happy receipts use Step-1 recovered hashes):
```json
[
  {
    "cycleId": "happy", "status": "distributed",
    "verdicts": [
      { "source": "v1", "verdict": "yes", "observedAmount": "1000000000000", "signer": "21423f386b2700fe0cc65a5bb3bbb8dcadfa1dac6abe89b51f23b0af72c72892", "signature": "" },
      { "source": "v2", "verdict": "yes", "observedAmount": "1000000000000", "signer": "d13c0fd57a9f58046fa4527777d3367350c739bc97eb55a21d6452267da65105", "signature": "" },
      { "source": "v3", "verdict": "yes", "observedAmount": "1000000000000", "signer": "4970062de460a171b72fd7546ff17efaaceacf1c615a239cb1e254f736566697", "signature": "" }
    ],
    "receipts": [
      { "verifierId": "v1", "deployHash": "<<recovered: happy-v1>>", "linkable": true },
      { "verifierId": "v2", "deployHash": "<<recovered: happy-v2>>", "linkable": true },
      { "verifierId": "v3", "deployHash": "<<recovered: happy-v3>>", "linkable": true }
    ],
    "quorum": { "yesCount": 3, "required": 2, "met": true },
    "distributeTx": "6821e0f3e6b01325965562f964047782dab13d4602b7dae7bc7e67c70ac37829",
    "payouts": [ { "holderLabel": "Holder A", "motes": "7000000000" }, { "holderLabel": "Holder B", "motes": "3000000000" } ]
  },
  {
    "cycleId": "fraud", "status": "halted", "reason": "quorum_not_met",
    "verdicts": [
      { "source": "v1", "verdict": "yes", "observedAmount": "1000000000000", "signer": "21423f386b2700fe0cc65a5bb3bbb8dcadfa1dac6abe89b51f23b0af72c72892", "signature": "bc38ccf263b0dcdf140dd1026045f5e4dcc1e32eacdc3125b8b86051eea769642d35e77947c1915c8ef00970907b1733c82f0f10f296b6175a0e0c0d12351d04" },
      { "source": "v2", "verdict": "no", "observedAmount": "0", "signer": "d13c0fd57a9f58046fa4527777d3367350c739bc97eb55a21d6452267da65105", "signature": "d7c1a7068f3224028dceba8e587c8a57a8ad0042c1698c7f3327849aad5fb92851cab673f8631bd7e392a8b1052388bd9ba956974e970df6dac067111ffa9b0a" },
      { "source": "v3", "verdict": "no", "observedAmount": "0", "signer": "4970062de460a171b72fd7546ff17efaaceacf1c615a239cb1e254f736566697", "signature": "7634e2c4a625eda0ae47fd0860eb9f00dc66a7117201d1ac47b158b569689ace6f4d398920f8b4b3ec6ca58ca80bdda347e0adf5e7a3803d8049778877e2640d" }
    ],
    "receipts": [
      { "verifierId": "v1", "deployHash": "a02b1c7d2ed52ea82ff68740d9b5a65d9716cee8594b482a13d0c27e846d6a7d", "linkable": true },
      { "verifierId": "v2", "deployHash": "40a85e53df987e9af3b3e2261833419de84676245332c5fa8570354b8875df93", "linkable": true },
      { "verifierId": "v3", "deployHash": "8a962e502601c27db98a8195ef6c790f18df25f32c56b40306c02d8f5b4115ff", "linkable": true }
    ],
    "quorum": { "yesCount": 1, "required": 2, "met": false }
  }
]
```

- [ ] **Step 4: Write the failing test** — `dashboard/lib/data.test.ts`

```ts
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
```

- [ ] **Step 5: Run test to verify it fails** — Run: `pnpm --filter @quittance/dashboard test` → FAIL.

- [ ] **Step 6: Implement `lib/data.ts`** (validates the invariant that `quorum.yesCount` equals the yes-verdicts, so a malformed ledger fails the build, not the demo)

```ts
import asset from '../data/asset.json';
import cycles from '../data/cycles.json';
import type { AssetConfig, Cycle } from './types';

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
    if (c.quorum.met !== (yes >= c.quorum.required)) throw new Error(`cycle ${c.cycleId}: quorum.met inconsistent`);
    if (c.quorum.met && c.status !== 'distributed') throw new Error(`cycle ${c.cycleId}: met but not distributed`);
    if (!c.quorum.met && c.status !== 'halted') throw new Error(`cycle ${c.cycleId}: not met but not halted`);
  }
  return list;
}
```

- [ ] **Step 7: Run test to verify it passes** — Run: `pnpm --filter @quittance/dashboard test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/lib/types.ts dashboard/lib/data.ts dashboard/lib/data.test.ts dashboard/data/ dashboard/scripts/recover-hashes.mjs
git commit -S -m "feat(dashboard): committed on-chain ledger + typed loader with invariants"
```

---

### Task 4: `lib/chain.ts` — live balances with graceful fallback

**Files:**
- Create: `dashboard/lib/chain.ts`, `dashboard/lib/chain.test.ts`

**Interfaces:**
- Consumes: `Holder` from `lib/types.ts`.
- Produces: `liveBalanceMotes(publicKeyHex: string): Promise<string | null>` (null on any error — caller falls back to the ledger payout).

- [ ] **Step 1: Write the failing test** — `dashboard/lib/chain.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails** — Run: `pnpm --filter @quittance/dashboard test` → FAIL.

- [ ] **Step 3: Implement `lib/chain.ts`**

```ts
const RPC_URL = process.env.CASPER_NODE_URL ?? 'https://node.testnet.casper.network/rpc';

export async function liveBalanceMotes(publicKeyHex: string): Promise<string | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query_balance', params: { purse_identifier: { main_purse_under_public_key: publicKeyHex } } }),
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
```

- [ ] **Step 4: Run test to verify it passes** — Run: `pnpm --filter @quittance/dashboard test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/chain.ts dashboard/lib/chain.test.ts
git commit -S -m "feat(dashboard): live query_balance reads with graceful fallback"
```

---

### Task 5: Presentational components — `TxLink`, `VerifierBadge`, `VerdictCard`, `QuorumGate`

**Files:**
- Create: `dashboard/components/TxLink.tsx`, `dashboard/components/VerifierBadge.tsx`, `dashboard/components/VerdictCard.tsx`, `dashboard/components/QuorumGate.tsx`, `dashboard/components/components.test.tsx`
- Create: `dashboard/vitest.config.mts`, `dashboard/vitest.setup.ts`

**Interfaces:**
- Consumes: `Verdict` from `lib/types.ts`; `truncateHash`, `deployUrl`, `accountUrl` from `lib/format.ts`.
- Produces: `<TxLink kind="deploy|account|contract" hash label?>`, `<VerifierBadge verifier>`, `<VerdictCard verdict receipt?>`, `<QuorumGate yesCount required met>`.

- [ ] **Step 1: Add vitest react config** — `dashboard/vitest.config.mts`

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], globals: true },
});
```

`dashboard/vitest.setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 2: Write the failing test** — `dashboard/components/components.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TxLink } from './TxLink';
import { QuorumGate } from './QuorumGate';
import { VerdictCard } from './VerdictCard';

describe('components', () => {
  it('TxLink builds a deploy url', () => {
    render(<TxLink kind="deploy" hash="a02b1c7d2ed52ea82ff68740d9b5a65d9716cee8594b482a13d0c27e846d6a7d" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://testnet.cspr.live/deploy/a02b1c7d2ed52ea82ff68740d9b5a65d9716cee8594b482a13d0c27e846d6a7d');
  });
  it('QuorumGate shows MET vs NOT MET', () => {
    const { rerender } = render(<QuorumGate yesCount={3} required={2} met />);
    expect(screen.getByText(/MET/i)).toBeInTheDocument();
    rerender(<QuorumGate yesCount={1} required={2} met={false} />);
    expect(screen.getByText(/NOT MET/i)).toBeInTheDocument();
  });
  it('VerdictCard renders yes vs no', () => {
    render(<VerdictCard verdict={{ source: 'v1', verdict: 'yes', observedAmount: '1000000000000', signer: '2142', signature: 'bc38' }} />);
    expect(screen.getByText(/v1/)).toBeInTheDocument();
    expect(screen.getByText(/yes/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — Run: `pnpm --filter @quittance/dashboard test` → FAIL.

- [ ] **Step 4: Implement the four components**

`dashboard/components/TxLink.tsx`:
```tsx
import { ExternalLink } from 'lucide-react';
import { truncateHash, deployUrl, accountUrl, contractUrl } from '@/lib/format';

const URL_FOR = { deploy: deployUrl, account: accountUrl, contract: contractUrl } as const;

export function TxLink({ kind, hash, label }: { kind: 'deploy' | 'account' | 'contract'; hash: string; label?: string }) {
  return (
    <a href={URL_FOR[kind](hash)} target="_blank" rel="noreferrer"
       className="inline-flex items-center gap-1 font-mono text-xs text-sky-400 hover:underline">
      {label ?? truncateHash(hash)} <ExternalLink size={11} />
    </a>
  );
}
```

`dashboard/components/QuorumGate.tsx`:
```tsx
import { ShieldCheck, ShieldX } from 'lucide-react';

export function QuorumGate({ yesCount, required, met }: { yesCount: number; required: number; met: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${met ? 'border-yes/40 bg-yes/10' : 'border-no/40 bg-no/10'}`}>
      {met ? <ShieldCheck className="text-yes" /> : <ShieldX className="text-no" />}
      <div>
        <div className={`font-semibold ${met ? 'text-yes' : 'text-no'}`}>{met ? 'QUORUM MET' : 'QUORUM NOT MET'}</div>
        <div className="font-mono text-xs text-muted">{yesCount}/{required + 1 <= 3 ? 3 : required} verifiers said yes · need {required}</div>
      </div>
    </div>
  );
}
```

`dashboard/components/VerdictCard.tsx`:
```tsx
import { Check, X } from 'lucide-react';
import type { Verdict, Receipt } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { TxLink } from './TxLink';

export function VerdictCard({ verdict, receipt }: { verdict: Verdict; receipt?: Receipt }) {
  const yes = verdict.verdict === 'yes';
  return (
    <div className={`rounded-lg border p-3 ${yes ? 'border-yes/30' : 'border-no/30'} bg-panel`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm">{verdict.source}</span>
        <span className={`inline-flex items-center gap-1 text-sm font-semibold ${yes ? 'text-yes' : 'text-no'}`}>
          {yes ? <Check size={14} /> : <X size={14} />}{verdict.verdict}
        </span>
      </div>
      <div className="mt-1 font-mono text-xs text-muted">observed {motesToCspr(verdict.observedAmount)} CSPR</div>
      <div className="mt-1 font-mono text-[11px] text-muted">signed by {verdict.signer.slice(0, 8)}…</div>
      {receipt && (receipt.linkable
        ? <div className="mt-2 text-xs">paid: <TxLink kind="deploy" hash={receipt.deployHash} /></div>
        : <div className="mt-2 font-mono text-[11px] text-muted">paid: {receipt.deployHash.slice(0, 8)}…</div>)}
    </div>
  );
}
```

`dashboard/components/VerifierBadge.tsx`:
```tsx
import type { Verifier } from '@/lib/types';
import { TxLink } from './TxLink';

export function VerifierBadge({ verifier }: { verifier: Verifier }) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-3 py-2">
      <div className="font-mono text-sm">{verifier.label}</div>
      <div className="mt-1 text-xs"><TxLink kind="account" hash={verifier.publicKeyHex} label={`${verifier.publicKeyHex.slice(0, 10)}…`} /></div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes** — Run: `pnpm --filter @quittance/dashboard test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/components/ dashboard/vitest.config.mts dashboard/vitest.setup.ts
git commit -S -m "feat(dashboard): verdict, quorum, verifier, and tx-link components"
```

---

### Task 6: `CycleCard` — the thesis surface

**Files:**
- Create: `dashboard/components/CycleCard.tsx`, `dashboard/components/CycleCard.test.tsx`

**Interfaces:**
- Consumes: `Cycle` from `lib/types.ts`; `VerdictCard`, `QuorumGate`, `TxLink`; `motesToCspr`.
- Produces: `<CycleCard cycle>`.

- [ ] **Step 1: Write the failing test** — `dashboard/components/CycleCard.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CycleCard } from './CycleCard';
import { getCycles } from '@/lib/data';

const cycles = getCycles();

describe('CycleCard', () => {
  it('happy cycle shows DISTRIBUTE + payouts', () => {
    render(<CycleCard cycle={cycles.find((c) => c.cycleId === 'happy')!} />);
    expect(screen.getByText(/DISTRIBUTE/i)).toBeInTheDocument();
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });
  it('fraud cycle shows HALT and no distribute', () => {
    render(<CycleCard cycle={cycles.find((c) => c.cycleId === 'fraud')!} />);
    expect(screen.getByText(/HALT/i)).toBeInTheDocument();
    expect(screen.getByText(/funds withheld/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `pnpm --filter @quittance/dashboard test` → FAIL.

- [ ] **Step 3: Implement `CycleCard.tsx`**

```tsx
import type { Cycle } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { VerdictCard } from './VerdictCard';
import { QuorumGate } from './QuorumGate';
import { TxLink } from './TxLink';

export function CycleCard({ cycle }: { cycle: Cycle }) {
  const receiptFor = (id: string) => cycle.receipts.find((r) => r.verifierId === id);
  return (
    <section className="rounded-xl border border-edge bg-panel/40 p-4">
      <h3 className="mb-3 font-semibold capitalize">{cycle.cycleId} cycle</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        {cycle.verdicts.map((v) => <VerdictCard key={v.source} verdict={v} receipt={receiptFor(v.source)} />)}
      </div>
      <div className="mt-3"><QuorumGate yesCount={cycle.quorum.yesCount} required={cycle.quorum.required} met={cycle.quorum.met} /></div>
      <div className="mt-3 rounded-lg border border-edge px-4 py-3">
        {cycle.status === 'distributed' ? (
          <div>
            <div className="font-semibold text-yes">DISTRIBUTE</div>
            <ul className="mt-1 font-mono text-sm">
              {cycle.payouts?.map((p) => <li key={p.holderLabel}>{p.holderLabel}: +{motesToCspr(p.motes)} CSPR</li>)}
            </ul>
            {cycle.distributeTx && <div className="mt-1 text-xs">tx: <TxLink kind="deploy" hash={cycle.distributeTx} /></div>}
          </div>
        ) : (
          <div>
            <div className="font-semibold text-no">HALT — funds withheld</div>
            <div className="mt-1 font-mono text-sm text-muted">no distribution · holders unchanged</div>
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `pnpm --filter @quittance/dashboard test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/components/CycleCard.tsx dashboard/components/CycleCard.test.tsx
git commit -S -m "feat(dashboard): CycleCard — verdicts → quorum gate → outcome"
```

---

### Task 7: Issuer route (`/`) + `AssetHeader`

**Files:**
- Create: `dashboard/components/AssetHeader.tsx`
- Modify: `dashboard/app/page.tsx`

**Interfaces:**
- Consumes: `getAsset`, `getCycles`; `AssetHeader`, `VerifierBadge`, `CycleCard`, `TxLink`; `motesToCspr`.

- [ ] **Step 1: Implement `AssetHeader.tsx`**

```tsx
import { FileText } from 'lucide-react';
import type { AssetConfig } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { TxLink } from './TxLink';

export function AssetHeader({ asset }: { asset: AssetConfig }) {
  return (
    <header className="rounded-xl border border-edge bg-panel/40 p-5">
      <div className="flex items-center gap-2 text-accent"><FileText size={18} /><span className="font-semibold">{asset.reference}</span></div>
      <p className="mt-2 max-w-2xl text-sm text-muted">{asset.narrative}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-muted">Expected cashflow</dt><dd className="font-mono">{motesToCspr(asset.expectedCashflowMotes)} CSPR</dd></div>
        <div><dt className="text-muted">Pool funded</dt><dd className="font-mono">{motesToCspr(asset.pool.fundedMotes)} CSPR</dd></div>
        <div><dt className="text-muted">Quorum</dt><dd className="font-mono">{asset.quorumRequired}-of-{asset.verifiers.length}</dd></div>
        <div><dt className="text-muted">Vault</dt><dd><TxLink kind="contract" hash={asset.vault.packageHash} label="contract" /></dd></div>
      </dl>
    </header>
  );
}
```

- [ ] **Step 2: Replace `app/page.tsx` with the Issuer route**

```tsx
import { getAsset, getCycles } from '@/lib/data';
import { AssetHeader } from '@/components/AssetHeader';
import { VerifierBadge } from '@/components/VerifierBadge';
import { CycleCard } from '@/components/CycleCard';

export const revalidate = 15;

export default function IssuerPage() {
  const asset = getAsset();
  const cycles = getCycles();
  return (
    <div className="space-y-8">
      <AssetHeader asset={asset} />
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Holders & verifiers</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-edge bg-panel/40 p-4">
            <h3 className="mb-2 font-semibold">Holders</h3>
            {asset.holders.map((h) => <div key={h.label} className="flex justify-between font-mono text-sm"><span>{h.label}</span><span>{h.weightPct}%</span></div>)}
          </div>
          <div className="rounded-xl border border-edge bg-panel/40 p-4">
            <h3 className="mb-2 font-semibold">Verifiers</h3>
            <div className="grid gap-2">{asset.verifiers.map((v) => <VerifierBadge key={v.label} verifier={v} />)}</div>
          </div>
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Cycle history — verify, not attest</h2>
        <div className="grid gap-4 lg:grid-cols-2">{cycles.map((c) => <CycleCard key={c.cycleId} cycle={c} />)}</div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Verify the route renders** — Run: `pnpm --filter @quittance/dashboard dev`, open http://localhost:3000. Expected: header, holders/verifiers, both cycle cards side by side (happy → DISTRIBUTE, fraud → HALT). Click one tx link → resolves on testnet.cspr.live.

- [ ] **Step 4: Commit**

```bash
git add dashboard/components/AssetHeader.tsx dashboard/app/page.tsx
git commit -S -m "feat(dashboard): issuer route — asset config + cycle history"
```

---

### Task 8: Holder route (`/holder`) + `HolderRow` with live balances

**Files:**
- Create: `dashboard/components/HolderRow.tsx`, `dashboard/app/holder/page.tsx`

**Interfaces:**
- Consumes: `getAsset`, `getCycles`, `liveBalanceMotes`; `motesToCspr`, `TxLink`.

- [ ] **Step 1: Implement `HolderRow.tsx`** (server component; balance + fallback resolved by the page)

```tsx
import type { Holder } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { TxLink } from './TxLink';

export function HolderRow({ holder, receivedMotes, liveMotes, distributeTx }: { holder: Holder; receivedMotes: string; liveMotes: string | null; distributeTx?: string }) {
  return (
    <div className="rounded-xl border border-edge bg-panel/40 p-4">
      <div className="flex items-center justify-between">
        <div><div className="font-semibold">{holder.label}</div><div className="font-mono text-xs text-muted">{holder.weightPct}% · <TxLink kind="account" hash={holder.publicKeyHex} label={`${holder.accountHash.slice(0, 10)}…`} /></div></div>
        <div className="text-right">
          <div className="font-mono text-lg">{liveMotes ? motesToCspr(liveMotes) : motesToCspr(receivedMotes)} CSPR</div>
          <div className="text-[11px] text-muted">{liveMotes ? 'live balance' : 'live read unavailable — ledger value'}</div>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted">received {motesToCspr(receivedMotes)} CSPR in the happy cycle{distributeTx && <> · <TxLink kind="deploy" hash={distributeTx} /></>}</div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `app/holder/page.tsx`**

```tsx
import { getAsset, getCycles } from '@/lib/data';
import { liveBalanceMotes } from '@/lib/chain';
import { HolderRow } from '@/components/HolderRow';

export const revalidate = 15;

export default async function HolderPage() {
  const asset = getAsset();
  const happy = getCycles().find((c) => c.cycleId === 'happy')!;
  const rows = await Promise.all(asset.holders.map(async (h) => ({
    holder: h,
    received: happy.payouts?.find((p) => p.holderLabel === h.label)?.motes ?? '0',
    live: await liveBalanceMotes(h.publicKeyHex),
  })));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Holder receipts</h1>
      <p className="text-sm text-muted">After the fraud cycle halted, these balances are unchanged — the refusal, from the holder&apos;s side.</p>
      <div className="grid gap-3">
        {rows.map((r) => <HolderRow key={r.holder.label} holder={r.holder} receivedMotes={r.received} liveMotes={r.live} distributeTx={happy.distributeTx} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify** — Run dev server, open http://localhost:3000/holder. Expected: Holder A ~7 CSPR, Holder B ~3 CSPR (live), with received amounts + distribute link. Kill the network / set a bad `CASPER_NODE_URL` once to confirm the fallback label appears (then restore).

- [ ] **Step 4: Commit**

```bash
git add dashboard/components/HolderRow.tsx dashboard/app/holder/
git commit -S -m "feat(dashboard): holder route — receipts + live balances with fallback"
```

---

### Task 9: Visual polish + Railway deploy

**Files:**
- Create: `railway.json`, `dashboard/.env.example`
- Modify: theme tokens / spacing as needed (use `frontend-design` skill for the proof-receipt aesthetic pass)

**Interfaces:**
- Produces: a live Railway URL serving the dashboard.

- [ ] **Step 1: Aesthetic pass** — Invoke the `frontend-design` skill; refine `globals.css` + Tailwind tokens for the dark "proof-receipt" identity (quorum gate as hero, monospace data, restrained Casper-red accent). Keep all changes within `app/globals.css`, `tailwind.config.ts`, and component className tweaks. Re-run `pnpm --filter @quittance/dashboard test` (must stay green) and visually verify both routes.

- [ ] **Step 2: Build locally** — Run: `pnpm --filter @quittance/dashboard build`. Expected: `next build` succeeds, `.next/standalone` produced, no type errors.

- [ ] **Step 3: Add `dashboard/.env.example`**

```
# Public Casper testnet RPC — no secrets required.
CASPER_NODE_URL=https://node.testnet.casper.network/rpc
```

- [ ] **Step 4: Add `railway.json`** (root)

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS", "buildCommand": "pnpm install --frozen-lockfile && pnpm --filter @quittance/dashboard build" },
  "deploy": { "startCommand": "pnpm --filter @quittance/dashboard start", "restartPolicyType": "ON_FAILURE" }
}
```

- [ ] **Step 5: Deploy via the `use-railway` skill** — Invoke `use-railway`; create a project/service from this repo, set `CASPER_NODE_URL`, and deploy. **Before granting it anything sensitive, read its SKILL.md** (Snyk flagged it High-Risk; no secrets are involved here, but verify). Capture the public URL.

- [ ] **Step 6: Verify the live URL** — Open the Railway URL: both routes render, cycle cards correct, live balances resolve, tx links open on cspr.live.

- [ ] **Step 7: Commit**

```bash
git add railway.json dashboard/.env.example dashboard/app/globals.css dashboard/tailwind.config.ts
git commit -S -m "feat(dashboard): proof-receipt theme + Railway deploy config"
```

---

## Self-Review

**1. Spec coverage:**
- §4 stack (Next/Tailwind/Lucide) → Task 1. §5 data (asset/cycles/chain) → Tasks 3, 4. §6 routes → Tasks 7, 8. §7 components → Tasks 5, 6, 7, 8. §8 visual → Task 9. §9 error/fallback → Task 4 (chain) + Task 8 (UI). §10 testing → Tasks 2–6. §11 Railway → Task 9. §12 structure → all. §13 risks: cspr.live path resolved (`/deploy/`, Global Constraints), holder dual-identifier resolved (Reference Data), Railway build (Task 9), vitest+Next (Task 5). All covered.

**2. Placeholder scan:** The only `<<recovered: …>>` markers are in Task 3 JSON and are explicitly the output of the provided `recover-hashes.mjs` script run in Task 3 Step 1 — a concrete action, not a vague TODO. Every other step has complete code.

**3. Type consistency:** `Holder.publicKeyHex`/`accountHash`, `Verdict.{source,verdict,observedAmount,signer,signature}`, `Receipt.{verifierId,deployHash,linkable}`, `Cycle.{cycleId,status,reason?,verdicts,receipts,quorum,distributeTx?,payouts?}` are defined in Task 3 `lib/types.ts` and used identically in Tasks 4–8. `liveBalanceMotes(publicKeyHex)` (Task 4) is consumed in Task 8. `motesToCspr`/`truncateHash`/`deployUrl`/`accountUrl`/`contractUrl` (Task 2) are consumed in Tasks 5–8. Consistent.

## Execution Handoff

After saving the plan, offer the execution choice (subagent-driven vs inline).
