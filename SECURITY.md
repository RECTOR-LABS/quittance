# Security Policy

## Supported versions

Quittance is a **Casper Agentic Buildathon** prototype. It targets **Casper Testnet
(`casper-test`) only** — there is no mainnet deployment and no real funds at stake. Security
fixes are applied to the latest `main` only.

| Version | Supported |
| --- | --- |
| `main` (testnet) | ✅ |
| tagged releases | ✅ |
| older branches | ❌ |

## Testnet-only scope

Everything in this repository runs on `casper-test`:

- The `ServicerVault` contract holds a **native test CSPR** distribution pool.
- Verifier payments use **WCSPR** (a test CEP-18) via x402.
- The payout token is a **test asset**, not a real stablecoin.
- All funded accounts are testnet identities.

**There are no real funds, no production keys, and no mainnet contracts in this repo.**

## Reporting a vulnerability

We take security reports seriously even for a testnet prototype — responsible disclosure
makes the project better.

**Please do not open a public GitHub issue for security reports.**

Instead, report privately:

- 📧 Email: **rector@rectorspace.com**
- Preferably include: a description, steps to reproduce, affected file(s)/commit, and impact.

You should receive an acknowledgment within **72 hours**. Please give us a reasonable window
(we suggest 90 days) to address the issue before any public disclosure. We will credit
reporters who request it once a fix is shipped.

## What to report

- Bugs that could let a verifier be bribed past the 2-of-3 quorum, or let `distribute()`
  execute without a valid quorum proof.
- Anything that breaks the **idempotency** of `distribute()` per `(asset_id, cycle_id)`
  (double-distribution).
- Failures in the x402 settlement that could cause double-payment or payment without a
  verdict.
- Key/secret leakage — although **no secrets belong in this repo** (see below).

## Secrets

This repository **must never contain secrets**. Key files are gitignored and verified
untracked:

- `secret_key.pem` — funded testnet key (local only)
- `.env` / `.env.local` / any `.env.*` (except `.env.example`)
- `VERIFIER_SIGNING_KEY_HEX`, `VERIFIER_PAYTO`, `CSPR_CLOUD_TOKEN`, `ANTHROPIC_API_KEY`

If you believe a secret was accidentally committed, **contact rector@rectorspace.com
immediately** so the history can be scrubbed and the key rotated. (For this testnet project,
rotation means generating a new throwaway key — see `.env.example`.)

## Hardening already in place

- Mutating contract entrypoints are **servicer-key gated**; inputs are range-checked.
- `distribute()` is **idempotent** per `(asset_id, cycle_id)`.
- The dashboard reads balances **read-only** with a full try/catch fallback to the committed
  ledger — a node failure never crashes the page.
- Dependencies are kept current via **Dependabot**; **CodeQL** and **CI** run on every push
  and pull request. High-or-greater advisories are treated as release blockers.
