# Contributing to Quittance

First off — thanks for taking the time to contribute. 🎉

Quittance is an autonomous, verification-gated servicing agent for tokenized real-world
cashflows on Casper. The core idea is **verify, not attest**: a 2-of-3 verifier quorum must
confirm a cashflow arrived before any on-chain distribution can happen.

> **Network:** This project targets **Casper Testnet only** (`casper-test`). All values,
> keys, and tokens here are testnet. See [SECURITY.md](./SECURITY.md) and the
> [honesty & disclosure](./README.md#honesty--disclosure) section of the README.

## Quick start

Prerequisites: **Node ≥ 20**, **pnpm ≥ 10**, and (only for the contract) the **Rust toolchain
+ [cargo-odra](https://odra.dev)**.

```bash
pnpm install                                   # install the whole workspace
pnpm --recursive build                         # build all TS packages (workspace order)
pnpm --recursive test                          # run every test suite
pnpm --filter @quittance/dashboard dev          # dashboard at http://localhost:3000
```

See the [README](./README.md#run-it-locally) for the contract build and the end-to-end
harness on `casper-test`.

## Repository layout

```
contracts/        ServicerVault — Odra (Rust) smart contract
packages/core/    domain logic (types, quorum, signing) — framework-free
packages/adapters/ real SDK adapters (casper-js-sdk v5, casper-x402)
agent/            autonomous servicer agent (runCycle state machine)
verifiers/        x402-gated verifier services
dashboard/        Next.js dashboard (issuer + holder views)
e2e/               end-to-end harness
```

`core` has no internal dependencies; `agent` depends on `core` + `verifier`; `adapters`
depends on `core` + `agent` + `verifier`. `dashboard` and `contracts` are self-contained.

## How to contribute

### 1. Find or open an issue

Check [open issues](https://github.com/RECTOR-LABS/quittance/issues) first. If your change
isn't covered, open one so we can align before you write code.

### 2. Branch

Branch from `main` using a conventional prefix:

```
feat/<short-description>      new feature
fix/<short-description>       bug fix
chore/<short-description>     tooling, deps, CI, docs housekeeping
docs/<short-description>      documentation only
refactor/<short-description>  no behavior change
```

### 3. Build, test, repeat

This project was delivered test-first, and we keep that bar. **Every new function, hook, or
component should ship with tests.** Aim for meaningful coverage of the behavior you added —
not 100% line coverage for its own sake.

```bash
pnpm --recursive build        # must pass
pnpm --recursive test         # must pass
```

Before opening the PR, run the suite for the package(s) you touched.

### 4. Commit

- Use [Conventional Commits](https://www.conventionalcommits.org/) — e.g.
  `feat(agent): retry verifier on 5xx with backoff`.
- Keep commits focused — **one commit per logical change**. Don't batch unrelated work.
- **Stage files explicitly** (`git add <path> …`). Never `git add -A` / `git add .` — the
  working tree sometimes carries local tooling noise that must not be committed (see
  `.gitignore`).
- Commits are GPG-signed (`-S`). **No AI attribution** of any kind in commits, PRs, or docs —
  write as a human developer.

### 5. Open a pull request

Target `main`. Fill in the [PR template](./.github/PULL_REQUEST_TEMPLATE.md). Make sure CI is
green before requesting review.

## Tech constraints (don't regress these)

| Concern | Rule |
| --- | --- |
| Casper SDK | **`casper-js-sdk` v5 only.** v2-era code will not run. Most AI/tutorial output is v2 — verify before pasting. |
| Transactions | Casper 2.0 **TransactionV1**, not legacy Deploys. |
| Contract | **Odra 2.8.x**, Rust `nightly-2026-01-01`. |
| Next.js | **≥ 15.5.19** (CVE floor — never downgrade). |
| x402 header | `PAYMENT-SIGNATURE`, not `X-PAYMENT`. |
| Secrets | Never commit keys, `.env`, or `*.pem`. They're gitignored. |
| Code style | 2-space indent, ESM (`"type": "module"`), meaningful names, comments only for complex logic. |
| CSS | Tailwind. |
| Icons | `lucide-react`. No Unicode emojis as icons. |

## Reporting bugs & security issues

- Bugs → [open an issue](https://github.com/RECTOR-LABS/quittance/issues/new?template=bug_report.yml).
- Security vulnerabilities → see [SECURITY.md](./SECURITY.md) (do **not** open a public issue).

## Code of conduct

Participating in this project means following the [Code of Conduct](./CODE_OF_CONDUCT.md). Be
excellent to each other.
