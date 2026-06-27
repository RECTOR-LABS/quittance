# Quittance Dashboard — Design Spec

**Date:** 2026-06-27
**Status:** Approved design (brainstorming output) — pending implementation plan
**Author:** CIPHER (with RECTOR)
**Task:** Task 13 (Dashboard) of the Quittance buildathon build
**Deadline context:** Casper Agentic Buildathon, submission Jul 1 07:00 UTC (~3.5 days)

---

## 1. Purpose

A read-only web dashboard that makes Quittance's thesis — **"verify, not attest"** — visible and independently verifiable. It visualizes the two cycles already proven on-chain against the live `ServicerVault` (casper-test):

- **Happy** — 3-of-3 verifiers say "yes" → 2-of-3 quorum met → `distribute()` → holders paid 7 / 3 CSPR.
- **Fraud** — 1 compromised "yes" vs 2 honest "no" → quorum **not** met → agent **halts**, no distribute, holders unchanged.

The dashboard is the visual centerpiece of the demo video and a live URL a judge can visit. Every figure it shows is backed by a real on-chain transaction, deep-linked to `testnet.cspr.live`.

## 2. Scope

**In scope**
- Two routes: **Issuer** (`/`) and **Holder** (`/holder`).
- One asset (`inv-001`), 2 holders, 3 verifiers, 2 cycles (happy + fraud) — all read-only.
- Hybrid data: committed config/cycle ledger (backed by tx links) + live balance reads.
- Dark "proof-receipt" visual identity.
- Deploy to Railway.

**Out of scope (YAGNI)**
- Wallet connect, cycle triggering, any on-chain writes or mutations.
- Multi-asset abstraction, pagination, search.
- Auth, database, real-time streaming (CSPR.cloud SSE).
- A live issuer setup wizard (registration is already done on-chain; we display the configured state).

## 3. Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Hybrid data** — committed ledger + live balances | Fraud emits no on-chain vault event; its proof is off-chain signed verdicts + settle txs. Live balances prove current state; committed ledger carries the verdict story. |
| D2 | **Issuer + Holder routes** | Product-shaped; matches the SPEC's issuer/holder framing. |
| D3 | **Invoice story + on-chain truth** | Legible invoice-financing narrative, but every number is the real CSPR amount + cspr.live link. No invented dollar values. |
| D4 | **Commit asset/cycle config as JSON** (not live `state` dict read) | Odra packs all module state into one composite-keyed `state` dict; a generic live read is impractical. JSON is backed by tx links for verification. |
| D5 | **Dark "proof-receipt" aesthetic** | Reinforces cryptographic-verification credibility; distinctive vs templated admin themes. |
| D6 | **Server Components + `revalidate`** | Read-only; server-side reads avoid client-fetch surface area. Robust if RPC is down (committed data still renders). |

## 4. Architecture & stack

- **Package:** `dashboard/` workspace member (`@quittance/dashboard`), already reserved in `pnpm-workspace.yaml`.
- **Framework:** Next.js (latest stable, App Router) + TypeScript.
- **Styling:** Tailwind CSS; **Lucide React** icons (no Unicode emoji per project standard).
- **Rendering:** Server Components fetch live balances at request time and merge with the committed ledger. `export const revalidate = 15` (ISR) keeps it fresh. Optional manual "refresh" link.
- **No secrets:** the app only does read-only RPC (`query_balance`) against the public node. `CASPER_NODE_URL` is the sole required env var. The PEM / CSPR.cloud token are never used by the dashboard.

## 5. Data layer

Three sources, each picked for honesty + reliability. **All committed data contains only public on-chain identifiers** (pubkeys, account-hashes, contract/package hashes, tx hashes). **No private keys, no tokens** — the generators keep those in `~/Documents/secret/`.

### 5.1 `data/asset.json` (committed) — the registered asset/invoice config
Shape (illustrative):
```jsonc
{
  "assetId": "inv-001",
  "invoice": { "reference": "INV-001", "expectedCashflowMotes": "1000000000000", "narrative": "SMB receivable; investors hold fractions, repaid when the client pays." },
  "vault": { "entityHash": "6a6747d2…", "packageHash": "fb5225d8…", "installTx": "4313f749…" },
  "quorumRequired": 2,
  "pool": { "fundedMotes": "10000000000", "fundTx": "88ec8a49…" },
  "registerTx": "0b7f5b22…",
  "holders": [
    { "label": "Holder A", "publicKeyHex": "01…", "accountHash": "0c61a1f5…", "weightPct": 70 },
    { "label": "Holder B", "publicKeyHex": "01…", "accountHash": "48f10c6a…", "weightPct": 30 }
  ],
  "verifiers": [
    { "label": "v1", "publicKeyHex": "21423f38…", "payTo": "006851f5…" },
    { "label": "v2", "publicKeyHex": "d13c0fd5…", "payTo": "003dbead…" },
    { "label": "v3", "publicKeyHex": "4970062d…", "payTo": "004e6470…" }
  ]
}
```
**Two identifiers per holder, distinct purposes:** `publicKeyHex` drives the live `query_balance` read (`main_purse_under_public_key`); `accountHash` drives the cspr.live `/account` link. Both are public, copied from `holder-keys.json` (`pubHex` / `accountHash` fields). Verifier account links derive from `payTo` (drop the `00` key-tag). Exact full hashes are copied from the authoritative in-repo ledger `.superpowers/sdd/progress.md` (single source of truth for every tx hash) and the **public** fields of `~/Documents/secret/quittance/{holder,verifier}-keys.json` — never the `privHex`.

### 5.2 `data/cycles.json` (committed) — the two proven cycle outcomes
Mirrors the agent's `CycleOutcome` shape. Per cycle: `cycleId`, `status` (`distributed` | `halted`), `reason?`, the 3 `verdicts` (verdict yes/no, observedAmount, signer pubkey, signature), `receipts` (per-verifier x402 settle tx), derived `quorum` tally, and on success `distributeTx` + per-holder `payouts`.
- **Fraud** outcome is captured verbatim from this session's run (full verdicts, signatures, and settle txs `a02b1c7d…` / `40a85e53…` / `8a962e50…` are recorded).
- **Happy** outcome is reconstructed from the recorded settle txs (`bb6520be…` / `e05a3def…` / `8b8f30d7…`) + distribute tx `6821e0f3…`; the deterministic Ed25519 verdict signatures are reproduced by re-signing the identical verdict messages with the verifier keys (deterministic → identical bytes), or lifted from run logs. No re-run, no quota spent.
- A small emitter is added to `e2e/harness/run-cycle.mjs` so future live runs append their `CycleOutcome` to this ledger automatically (keeps it a byproduct of real runs, not hand-authored).

### 5.3 Live reads — `lib/chain.ts`
- `query_balance` with `main_purse_under_public_key` for each holder (the exact read `e2e/harness/check-balances.mjs` uses), returning current motes. No signing.
- **Graceful degradation:** on RPC error/timeout, fall back to the ledger's recorded post-cycle balance and render a quiet "live read unavailable" indicator. The committed data always renders, so the page never hard-fails during the demo.

## 6. Routes & pages

### 6.1 Issuer — `/`
Top-to-bottom:
1. **Invoice header** (`AssetHeader`) — INV-001, expected cashflow (1000 CSPR), status (Active), narrative line; vault + install-tx links.
2. **Holder split** — A 70% / B 30% with account links.
3. **Verifiers + quorum** — 3 `VerifierBadge`s (label, pubkey, payTo link) and the `2-of-3` quorum rule.
4. **Pool** — funded 10 CSPR, fund-tx link.
5. **Cycle history** — two `CycleCard`s (happy, fraud). This is the thesis surface.

### 6.2 Holder — `/holder`
Per holder (`HolderRow`): account link, weight, **amount received** in the happy cycle (+ distribute-tx link), and **live current balance**. A short note shows the fraud cycle added nothing (balances unchanged) — the refusal from the holder's side.

## 7. Components (each one job, testable)

| Component | Responsibility | Key props |
|-----------|----------------|-----------|
| `AssetHeader` | Invoice/asset config header | asset config |
| `VerifierBadge` | One verifier identity | label, pubkey, payTo |
| `VerdictCard` | One verifier's signed verdict | verdict, observedAmount, signer, settleTx |
| `QuorumGate` | The yes-count vs threshold decision | yesCount, required, met |
| `CycleCard` | A cycle: 3 verdicts → quorum gate → outcome | cycle (from ledger) |
| `HolderRow` | A holder receipt + live balance | holder, payout, liveBalance |
| `TxLink` | Deep link to cspr.live (deploy/account/contract) | kind, hash |
| `lib/data.ts` | Load + type the committed ledger | — |
| `lib/chain.ts` | Live `query_balance` reads + fallback | — |
| `lib/format.ts` | motes→CSPR, hash truncation, pct | — |

The `lib/*` pure functions are unit-tested (vitest, matching the monorepo): quorum tally derivation, motes→CSPR formatting, hash truncation, cspr.live URL building.

## 8. Visual design

Dark "proof-receipt" identity:
- **Quorum gate is the visual hero** — large MET / NOT-MET state with the yes-count.
- Monospace for hashes/amounts/signatures; sans for prose.
- Verdict coding: ✓ green (yes) / ✗ red (no), color-blind-safe with icon + label, not color alone.
- Casper-adjacent accent; restrained, technical, confident. Built with the `frontend-design` skill during implementation. SVG (not ASCII) for any diagram, dark-mode-first.

## 9. Error / empty / loading states

- **Live read fails** → ledger fallback value + "live read unavailable" chip. Never crash.
- **Loading** → lightweight skeletons on balance cells (the rest is static, instant).
- **Empty** → not applicable for the demo (fixed dataset), but `lib/data.ts` validates the ledger shape and fails the build loudly if malformed (catch data errors at build, not in the demo).

## 10. Testing

- Unit (vitest): `lib/format.ts`, `lib/data.ts` (ledger parse + quorum derivation), `TxLink` URL builder.
- A render smoke test for `CycleCard` (happy → DISTRIBUTE, fraud → HALT) to lock the thesis surface.
- Manual: `pnpm --filter @quittance/dashboard dev`, verify both routes, live balances, and every tx link resolves on cspr.live.

## 11. Deployment (Railway)

- Railway **Node service** building the Next.js app (`next build` / `next start`, standalone output).
- Env: `CASPER_NODE_URL=https://node.testnet.casper.network/rpc` (public; no secrets).
- Deploy driven via the `use-railway` skill (reviewed before it touches anything sensitive — though no secrets are involved here).
- Optional custom domain; otherwise the Railway-provided URL.

## 12. Project structure

```
dashboard/
  package.json            # @quittance/dashboard
  next.config.*           # standalone output for Railway
  tailwind.config.*
  app/
    layout.tsx            # shell, nav (Issuer | Holder), dark theme
    page.tsx              # Issuer route
    holder/page.tsx       # Holder route
  components/             # AssetHeader, VerifierBadge, VerdictCard, QuorumGate, CycleCard, HolderRow, TxLink
  lib/                    # data.ts, chain.ts, format.ts
  data/                   # asset.json, cycles.json (committed, public identifiers only)
  __tests__/ or *.test.ts # vitest
railway.json or Dockerfile # deploy config
```

## 13. Risks / open items (resolve during implementation)

- **cspr.live path for Casper 2.0 transactions** — verify `/deploy/<hash>` vs `/transaction/<hash>` (and account path) before wiring `TxLink`. Cheap to confirm against a known hash.
- **Happy verdict signatures** — confirm deterministic re-sign reproduces the original bytes; if any doubt, lift from logs rather than assert.
- **Railway Next.js build** — confirm standalone output + start command; first deploy may need a build-command tweak.
- **Monorepo test runner** — dashboard uses vitest like the other packages; confirm Next.js + vitest config doesn't fight the workspace tsconfig.

## 14. Success criteria

1. Both routes render the proven happy + fraud cycles with correct verdicts, quorum decision, and outcomes.
2. Live holder balances read on-chain (7 / 3 CSPR) with graceful fallback.
3. Every hash deep-links to a resolving cspr.live page.
4. Deployed and reachable on a Railway URL.
5. `lib/*` unit tests pass; `tsc` clean; consistent with monorepo conventions.
