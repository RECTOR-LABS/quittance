# Quittance — Project Context

> **Satellite context file** — read by Claude Code, Pi, and any AGENTS.md-aware agent.
> Host-neutral. The global CIPHER persona/conventions load from `~/.pi/agent/AGENTS.md`
> (pi) / `~/.claude/CLAUDE.md` (CC); this file is **project-specific** and does not repeat them.

---

## Mission

**Autonomous, verification-gated servicing for tokenized real-world cashflows on Casper.**

Quittance is an autonomous agent + an on-chain vault (`ServicerVault`) that releases a
tokenized cashflow to its holders **only after independently verifying the money actually
arrived** — *verification, not attestation.* Each cycle the agent pays **three independent
verifiers over [x402](https://x402.org)** to answer "did the cashflow arrive?", requires a
**2-of-3 quorum** of signed yes/no verdicts, and only then calls the contract's quorum-gated
`distribute()`. If the quorum fails, it **halts and pays out nothing.**

Built for the **Casper Agentic Buildathon 2026** · Casper Innovation Track · `casper-test`.

**The demonstrable moment:** feed a fake "paid" claim through one compromised verifier and
watch the agent refuse to release funds. That paid-for, independent, on-chain-enforced refusal
*is the whole product.* You cannot bribe one verifier to unlock the money.

---

## Current state (as of 2026-07-09)

**✅ SHIPPED & submitted** (DoraHacks BUIDL Casper Track). The buildathon qualifier scope is
complete and proven on-chain.

| Component | Status |
| --- | --- |
| `ServicerVault` (Odra/Rust) | ✅ Deployed `casper-test` (entity `6a6747d2…b27e132`) |
| Servicer agent (cycle state machine) | ✅ Runs both happy + fraud cycles end-to-end |
| x402 verifier payments | ✅ Settled on-chain (real CSPR.cloud facilitator) |
| Verifier services ×3 | ✅ Independent, x402-gated, signed verdicts |
| Dashboard (issuer + holder views) | ✅ Live balances read from chain |
| Demo video | ✅ 7 chunks, 2m28s, hosted at `/demo` |
| Tests | ✅ 90+ (core/adapters/verifiers) + 13 dashboard |

**Both paths are real and executed on [`testnet.cspr.live`](https://testnet.cspr.live)** — same
vault + same three verifiers, *only the consensus differs:*

| Path | Consensus | Result | Tx |
| --- | --- | --- | --- |
| ✅ Happy | 3/3 → quorum met | Holders **+7 / +3 CSPR** (pro-rata) | [`6821e0f3…c37829`](https://testnet.cspr.live/deploy/6821e0f3e6b01325965562f964047782dab13d4602b7dae7bc7e67c70ac37829) |
| 🛑 Fraud | 1/3 → quorum NOT met | Agent paid verifiers, **then halted** — holders unchanged | settles `a02b1c7d` / `40a85e53` / `8a962e50` |

**Deployment:** `quittance.rectorspace.com` (Vercel Hobby, GitHub integration, Cloudflare DNS
grey-cloud). Migrated off Railway on 2026-07-02 (PRs #1, #2). Holder view: `/holder`. Demo: `/demo`.

**Buildathon review status (2026-07-09):** submission is **in review**; final round is invite-only
(email notification). The Casper hosts posted final-round requirements (DoraHacks msgs
2026-07-07 / 2026-07-09): public repo, required topics (`casper-blockchain`, `casper-network`,
`buildathon`), community health files, CodeQL + Dependabot + CI, no High+ alerts, contract
hashes + sample testnet txs on the BUIDL page. **All in-repo items landed** in PR #3
(`chore/buildathon-compliance`): community health 50%→100%, CodeQL (JS/TS + actions),
Dependabot (npm + github-actions, alerts + security updates enabled), and CI
(build → 121 tests → dashboard build). Hosts warn: keep the repo functional at all times
during review — a judge may visit mid-change. So: branch → verify green → merge small.

---

## Architecture

```
detect cycle → pay 3 verifiers (x402) → 2-of-3 quorum?
                                          ├─ yes → distribute on-chain + receipt
                                          └─ no  → HALT · funds withheld · dispute flagged
```

| Component | Responsibility | Stack |
| --- | --- | --- |
| **`ServicerVault`** | Holds native-CSPR pool + holder registry; records per-cycle receipts; exposes quorum-gated `distribute()`. | **Odra 2.8.x** (Rust), Casper |
| **Servicer agent** | Runs the cycle: pays verifiers over x402, enforces quorum, calls the contract through adapter seams, verifies finality. | TypeScript, `casper-js-sdk` v5 |
| **Verifier services ×3** | Independent, x402-gated HTTP endpoints returning *signed* yes/no verdicts over evidence. | TypeScript / Express |
| **Dashboard** | Issuer config + holder view: cycle history, quorum stamps, live on-chain balances, tx deep-links to cspr.live. | Next.js 15, Vercel |

---

## Repository layout (pnpm workspace)

```
quittance/
├── contracts/        # ServicerVault — Odra (Rust) smart contract + wasm  [standalone Rust crate]
├── packages/
│   ├── core/         # @quittance/core — domain logic (types, quorum, signing). FRAMEWORK-FREE.
│   └── adapters/     # @quittance/adapters — real SDK adapters (casper-js-sdk v5, casper-x402)
├── agent/            # @quittance/agent — autonomous servicer agent (runCycle state machine)
├── verifiers/        # @quittance/verifier — x402-gated verifier services + decision/signing logic
├── dashboard/        # @quittance/dashboard — Next.js (issuer + holder views), Vercel-deployed
├── e2e/              # end-to-end harness: deploy, fund, run-cycle, settle, check-balances
├── SPEC.md           # design spec
├── PLAN.md           # implementation plan
├── DAY1-DERISK.md    # critical-path de-risk runbook
└── docs/             # design specs + impl plans (superpowers-style)
```

**Workspace dependency graph** (internal):
```
core  ←  verifier (verifiers/)  ←  agent  ←  adapters
 [no internal deps]                    [depends on core + verifier]   [depends on core + agent + verifier]
dashboard  ←  (NO internal deps — self-contained for Vercel build)
contracts  ←  (standalone Rust crate)
```

---

## Commands

```bash
# --- workspace (from repo root) ---
pnpm install                                   # install the whole workspace
pnpm --recursive test                          # all TS packages
pnpm --recursive build                         # all TS packages

# --- per-package (use --filter or cd into dir) ---
pnpm --filter @quittance/core test             # domain logic (verdict + quorum)
pnpm --filter @quittance/adapters test         # SDK adapters
pnpm --filter @quittance/verifier test         # verifier decision logic + server
pnpm --filter @quittance/agent test            # servicer cycle state machine
pnpm --filter @quittance/dashboard dev          # dashboard http://localhost:3000
pnpm --filter @quittance/dashboard test         # dashboard unit tests
pnpm --filter @quittance/dashboard build        # production build (matches Vercel)

# --- contract (Rust/Odra) ---
cd contracts && cargo odra test                # OdraVM unit tests
cd contracts && cargo odra build               # build wasm (needs nightly-2026-01-01 + wasm-strip/wasm-opt)

# --- end-to-end on casper-test (needs funded testnet key — see .env.example) ---
node e2e/deploy-servicer.mjs submit            # deploy the vault
node e2e/harness/run-cycle.mjs happy           # quorum met  → distribute
node e2e/harness/run-cycle.mjs fraud           # quorum fails → halt
node e2e/harness/check-balances.mjs            # read holder balances from chain
```

**Engines:** Node ≥ 20, pnpm ≥ 10 (`packageManager: pnpm@10.33.2`).

---

## Tech stack & version pins (DO NOT regress)

| Layer | Choice | Gotcha |
| --- | --- | --- |
| Chain | Casper 2.0 "Condor" `casper-test` | **TransactionV1**, not legacy Deploys |
| Contract | **Odra 2.8.x**, Rust `nightly-2026-01-01` | `wasm-strip` + `wasm-opt` on PATH |
| SDK | **`casper-js-sdk` v5** (currently `5.0.12`) | **v2 code will NOT run.** Most AI/tutorial output is v2-era — reject it |
| Payments | `@make-software/casper-x402` `1.0.0` | Express sidecar for the server; headless client for the agent |
| UI | Next.js **15.5.19**, React 19, Tailwind 3 | 15.5.19 is a **CVE floor** (`CVE-2025-66478`) — never downgrade |
| Dashboard deps | `next`, `react`, `react-dom`, `lucide-react` only | **No internal workspace deps** — keeps the Vercel build self-contained |
| Icons | `lucide-react` | No Unicode emojis as icons in components |

---

## Critical x402 / Casper gotchas (learned the hard way)

These are the #1 sources of subtle breakage. Trust the repo over marketing copy / AI output.

1. **casper-js-sdk v5 ONLY.** v2 snippets (and most LLM output) reference removed APIs. Verify before pasting.
2. **x402 header is `PAYMENT-SIGNATURE`**, not `X-PAYMENT`. (The x402.org marketing copy is wrong about this.)
3. **Headless EIP-712 signing** (`transfer_with_authorization`, EIP-3009-style, `exact` scheme, `casper:*` CAIP-2) via an ED25519 key was the **#1 novelty and #1 risk** — it's solved, but it's fragile. Don't refactor blindly.
4. **CSPR.cloud facilitator auth:** one token (`CSPR_CLOUD_TOKEN`) unlocks BOTH the Node API AND the x402 facilitator. `X402_FACILITATOR_API_KEY` can be left blank to reuse it. Free testnet quota is **25 calls/month** — a single debugging session exhausts it. The buildathon "sponsored" layer stacks on top.
5. **Settlement model:** one on-chain deploy per x402 request (no batching). Design stays low-frequency (handful per cycle) to fit the quota by construction.
6. **Native CSPR pool, pro-rata transfers.** Payout token is a test CEP-18 (WCSPR) for verifier payments; holder distribution is native test CSPR.

---

## Configuration & secrets

- **`.env.example`** — the canonical env reference (Node URL, facilitator, WCSPR hash, verifier keys, LLM key). Read it; it's heavily commented.
- **Secrets live at `~/Documents/secret/`** (iCloud-encrypted), never in the repo. The repo's `secret_key.pem` + `.env*` are gitignored and **verified untracked**.
- **Casper devnet wallet** (shared, global): `~/Documents/secret/solana-devnet.json` is *Solana*, not relevant here. Quittance uses its own funded `casper-test` key (faucet = once per account).
- **Dashboard prod env (Vercel):** `CASPER_NODE_URL=https://node.testnet.cspr.cloud` (Production + Preview). Root Directory = `dashboard`.
- **LLM for agent narration:** `ANTHROPIC_API_KEY` or `OLLAMA_HOST`. Decisions stay deterministic; the LLM only narrates.

---

## Conventions

- **TypeScript:** 2-space indent, ESM (`"type": "module"`), `tsc` build, `vitest` test. Meaningful names; comments only for complex logic.
- **Testing:** TDD was the delivery method here — 90+ tests landed alongside features. Keep that bar for any new logic.
- **Contracts:** Odra idioms; inputs range-checked; mutating entrypoints servicer-key gated; `distribute()` idempotent per `(asset_id, cycle_id)`.
- **CSS:** Tailwind. Space Mono / IBM Plex Mono for the receipt aesthetic.
- **Commits:** GPG-signed (`-S`, key `BF47B9DC1FA320FA`), conventional prefixes (`feat/`, `fix/`, `chore/`, `docs/`), scope `dashboard`/`deploy`/`readme` etc. **Never `git add -A`** — see below. **No AI attribution** in commits/PRs/docs.
- **Diagrams:** SVG over ASCII (proportional fonts break ASCII). Hero asset at `assets/hero.png`.

### Working tree hygiene (important)

The working tree carries persistent **noise that must never be batch-committed** with feature work:
- `.gitignore` (uncommitted edit adding `.agents/` + `skills-lock.json` ignore — legit, commit separately as `chore`)
- `dashboard/next-env.d.ts` (Next.js auto-regenerates — never commit changes to it)

**Always stage files explicitly** (`git add <specific paths>`), never `git add -A` / `git add .`.

### Local tooling dirs (gitignored — not part of the project)

These are local agent/tool artifacts, **not** source. Don't rely on, edit, or commit them:
- `.remember/` — Claude Code "remember" plugin session logs/handoffs
- `.superpowers/` — subagent-driven-development scratch
- `.claude/` — Claude Code worktrees/settings (contains a stale agent worktree)
- `.agents/`, `skills-lock.json` — Railway skill (leftover; Railway was decommissioned)

---

## Honesty & disclosure (stated in the README — keep it that way)

- Off-chain *"cashflow arrived"* evidence is **mocked/sandboxed** in the demo — the three verifiers stand in for real payment-rail adapters (bank APIs, Stripe, etc.). The innovation is the **verification-gated autonomous release**, not the data source.
- **Testnet only.** Verifier payments use WCSPR via x402; holder distribution is native test CSPR; the payout token is a test asset, not a real stablecoin.
- The Casper x402 stack was weeks old when built; versions are pinned and gotchas documented above.

---

## Roadmap / next opportunities

The qualifier is shipped. Documented (but not yet built) Final-Round / post-hackathon work:
- **Real payment-rail adapter spike** — replace a mock verifier with a real data source (Stripe / bank API).
- **Queryable on-chain receipts** — `Mapping<(AssetId, CycleId), Receipt>` + a `get_receipt` read entrypoint (the qualifier ships the `Distributed` *event* as the receipt; a queryable read endpoint is the enhancement).
- **Multi-asset, multi-cycle** dashboard history.
- **Verifier marketplace** with staking/slashing (was candidate #2 — explicitly out of scope for the buildathon).
- **CI / security tooling** — **DONE** (PR #3): `ci.yml` (build + 121 tests + dashboard build), `codeql.yml` (JS/TS + actions, codeql-action v4), `dependabot.yml` (npm per workspace pkg + github-actions). The Rust contract (`cargo odra test`) is **not** in CI yet — needs pinned `nightly-2026-01-01` + cargo-odra + wasm tooling; add a dedicated job if contract churn resumes. The only known advisory is a postcss **moderate** (transitive via `next`, < High) — pinnable via `pnpm.overrides` if desired.

Track work in this file's "Current state" section and via the global cross-session TODO.
