# Quittance — Technical Specification

> Autonomous, verification-gated servicing for tokenized real-world cashflows on Casper.
> **Event:** Casper Agentic Buildathon 2026 · Casper Innovation Track · Casper Testnet.
> **Status:** Draft for review. No implementation until this spec is approved.

---

## 1. One-liner

Quittance is an autonomous agent plus an on-chain vault that releases a tokenized real-world cashflow to its holders **only after independently verifying the money actually arrived** — *verification, not attestation.*

## 2. Problem

Tokenized real-world assets (invoices, rent, royalties, private credit) are a real and growing on-chain market, but **servicing** them — confirming the off-chain cashflow genuinely landed, then distributing it to token holders — is still manual and trust-based.

On-chain today, the entire competitive field (52 buildathon submissions) and the incumbents (Chainlink ACE, ERC-3643) only push **data *in*** via oracles. **Nobody autonomously pushes verified cashflow *out*.** Holders must trust an issuer's word that "the rent/invoice was paid." That single trust gap is what keeps RWA distribution from scaling without intermediaries.

A second, deeper gap: even the projects that "attest" agent actions on-chain are — in their own words — keeping *"a diary, not proof."* Recording that a payout happened is not the same as proving the payout was *owed*.

## 3. Solution & differentiation

An autonomous **servicer agent** drives a periodic cycle against a lean Casper contract. Each cycle the agent pays (over x402) **three independent verifiers** to answer "did the cashflow arrive?", requires a **2-of-3 quorum**, and only then triggers the on-chain distribution to holders — writing a verifiable receipt. If the quorum is not met, it **halts and pays nothing.**

Differentiated on two axes simultaneously:

| Axis | The field (and market) | Quittance |
|---|---|---|
| Direction | Read data **in** (oracles) | Push verified cashflow **out** (servicing) |
| Trust model | **Attest** (single source / self-report) | **Verify** (2-of-3 independent quorum) |

Originality (calibrated): vs. the 52 submissions **5/5** (only one grazes cashflow-out, none do quorum-verified release); vs. wider market **4/5** (tokenization + compliance exist via ERC-3643/Chainlink; autonomous *servicing with verification* is not a shipped product).

## 4. Users & UX

Reference vertical for the demo: **tokenized invoice financing** — an SMB is owed $10k in 60 days, sells fractions to investors now for working capital; when the client pays, investors are repaid. Invoice financing is the demo anchor because it is the most legible in three minutes and offers the cleanest three-independent-source verification (bank API + accounting system + payment processor). Quittance is **asset-agnostic by design**; private credit, rent, and royalty streams are the documented expansion path (rent is deliberately not the demo anchor — a competing submission already grazes it).

| Actor | What they touch |
|---|---|
| **Issuer** (the SMB) | Dashboard: connect wallet → register the receivable as a token → set the verifier sources + holder split → fund + activate the servicer. One-time setup. |
| **Investors** (holders) | Hold fractions of the token. Holder view shows position, each distribution as it lands, and the per-cycle verification receipt (which verifiers confirmed, what they were paid, the tx hash). |
| **Servicer agent** | Autonomous. Runs the cycle below. This is the product. |

## 5. Architecture

Four components, TypeScript-first (Odra kept minimal — the feasibility read shows the hardest novelty is headless x402 signing, not the contract).

1. **`ServicerVault`** — Odra (Rust) contract. Holds the distribution pool, the holder registry, and a per-cycle verified-receipt log; exposes `distribute()`. On-chain heart + the "working smart contract" jury criterion.
2. **Servicer agent** — Node/TS, orchestrated by an LLM (Claude via API, or Ollama Cloud). Runs the cycle, pays verifiers through the `casper-x402` headless client, enforces the 2-of-3 gate, calls `distribute()`, and narrates state via the read-only Casper MCP server.
3. **Verifier services (×3)** — independent HTTP services, each gated behind x402, that answer "did cashflow X arrive?" with a signed yes/no. The agent pays each per check (*recursive x402*). Mocked for the demo; real payment-rail adapters (Stripe, bank APIs) post-hackathon.
4. **Dashboard** — Next.js (issuer config + holder view). The x402-paid endpoints run in a small **Express sidecar** because the `casper-x402` middleware is Express/Go-only.

## 6. Data flow — the servicing cycle

1. **Detect** — agent sees a cycle is due for a registered asset.
2. **Verify** — agent calls the 3 verifier endpoints; each returns `402`, agent signs an EIP-712 `transfer_with_authorization` and replays with the `PAYMENT-SIGNATURE` header; the sponsored facilitator settles one real tx per call on `casper-test`.
3. **Quorum** — agent collects the signed verdicts. **≥2 of 3 "yes"** → proceed. Otherwise → **halt, flag dispute, no payout.**
4. **Distribute** — agent calls `ServicerVault.distribute(cycle_id)`; the contract pays holders pro-rata and emits a `Distributed` event.
5. **Receipt** — `distribute` emits the cycle's `Distributed` event carrying the quorum proof (the registered signer set + verdict-hash digests) and the settled total; the holder view renders the receipt from the event log.

## 7. Smart contracts (Casper / Odra)

**`ServicerVault`** (lean, single module):
- **Storage:** `Mapping<AssetId, AssetConfig>` (token, schedule, holder split, verifier set), `Mapping<(AssetId, CycleId), Receipt>` (verdicts, amounts, status), `Var<Balance>` distribution pool per asset.
- **Entrypoints:** `register_asset`, `fund`, `distribute(asset_id, cycle_id, quorum_proof)` (guarded: only the configured servicer key; rejects a cycle already distributed — idempotent), `get_receipt` (read-only).
- **Events:** `AssetRegistered`, `Funded`, `Distributed`, `DisputeFlagged` (Casper Event Standard, streamed via CSPR.cloud).
- **Qualifier scope:** the per-cycle receipt is realized as the `Distributed` event (registered signer set, verdict-hash digests, settled total) — the auditable record the holder view streams via CSPR.cloud. A queryable `Mapping<(AssetId, CycleId), Receipt>` + `get_receipt` read entrypoint is a Final-Round enhancement; the qualifier `ServicerVault` ships `register_asset`, `fund`, `get_asset`, `pool_of`, and `distribute`.
- **Payout token:** reuse a CEP-18 (the `casper-x402` repo's deployer or WCSPR); only deploy a custom CEP-18 if needed.

Security posture: servicer-key gating on all mutating entrypoints; idempotent distribution keyed by `(asset_id, cycle_id)`; no upgradeable admin backdoor in the demo; all inputs range-checked.

## 8. Verification mechanism (2-of-3 over x402)

- Each verifier exposes `GET /verify?asset=…&cycle=…` behind x402.
- The agent pays each independently — these are **separate on-chain settlements**, demonstrating real recursive machine-to-machine commerce.
- Quorum is computed off-chain by the agent; the **quorum proof** (the registered signer set + the verdict-hash digests) is passed to `distribute()` and recorded on-chain in the `Distributed` event so anyone reading the log can re-check that ≥2 independent signers attested before funds moved.
- Anti-double-pay: each x402 settlement is idempotent on `(cycle, verifier)`; a confirmed settlement is never re-sent.

## 9. x402 integration (the critical path)

- **Headless EIP-712 signing** (`transfer_with_authorization`, EIP-3009-style, `exact` scheme, `casper:*` CAIP-2) via the `casper-x402` headless client holding an ED25519 key. **This is the #1 novelty and the #1 risk.**
- Header is `PAYMENT-SIGNATURE` (not `X-PAYMENT`); trust the repo over the marketing copy.
- **Sponsored facilitator is mandatory** — the free testnet quota is **25 calls/month**, which one debugging session would exhaust. Claim the buildathon perk Day 1.
- Settlement model is one on-chain deploy per request (no batching). Quittance's design uses **low-frequency, high-value** calls (a handful per cycle), which fits the quota by construction rather than fighting it.

## 10. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Chain | Casper 2.0 "Condor" testnet (`casper-test`) | TransactionV1, not legacy Deploys |
| Contract | Odra 2.8.x | toolchain pinned `nightly-2026-01-01`; `wasm-strip`/`wasm-opt` on PATH |
| SDK | `casper-js-sdk` **v5** | v2 code (and most AI/tutorial output) will not run |
| Payments | `@make-software/casper-x402` | Express sidecar; headless client for the agent |
| Read/narrate | Casper MCP server (hosted, read-only) | balances + settlement confirmation in the demo |
| Data | CSPR.cloud (REST + Streaming) | get a CSPR.build token Day 1 |
| Agent | Claude API or Ollama Cloud | LLM decision loop |
| UI | Next.js | dashboard + holder view |

## 11. Scope

**Qualifier (by Jul 1, 07:00 UTC) — must-have:**
- `ServicerVault` deployed to `casper-test`.
- Servicer agent runs one full cycle end-to-end: 3× x402 verifier calls → 2-of-3 → one real `distribute()` tx changing holder balances on-chain.
- Minimal dashboard (one asset, holder view with receipt + tx links).
- Public repo with README + the "honesty" disclosure.
- Demo video, including the **fake-claim refusal** moment.

**Final Round (Jul 6–19) — polish:**
- Dashboard UX, multi-asset, multi-cycle history.
- One real payment-rail adapter spike (replace a mock verifier).
- Test coverage, error-path hardening, deploy docs.

**Out of scope / YAGNI:** mainnet; a real stablecoin; KYC/compliance transfer-restriction engine (that's the saturated cluster — explicitly avoided); a verifier *marketplace* with staking/slashing (that was candidate #2 — out of scope here); secondary-market trading of the token.

## 12. Failure modes & error handling

| Failure | Handling |
|---|---|
| Verifier disagreement (<2 yes) | Halt cycle, emit `DisputeFlagged`, no payout, surface in dashboard |
| Verifier timeout / non-response | Bounded retry, then treat as no-vote; halt if quorum impossible |
| x402 settlement failure | Retry with backoff; idempotent on `(cycle, verifier)`; never double-pay |
| Partial / interrupted distribution | `distribute()` idempotent per `(asset, cycle)`; safe to resume |
| Facilitator quota hit | Pre-flight quota check; fail loud with actionable message (not silent) |
| Insufficient pool funds | Reject `distribute()` before any transfer; flag underfunded |

## 13. Risks & Day-1 de-risks (critical path)

1. Claim the **sponsored x402 facilitator** (escape the 25/month wall).
2. CSPR.build token + funded testnet wallet (faucet = once per account; budget a second account or email request for gas headroom).
3. Run the `casper-x402` 3-terminal quickstart end-to-end — confirm the 3-day-old SDK works in our environment.
4. **Spike headless EIP-712 signing → land ONE `transfer_with_authorization` on `casper-test`.** This is both the top risk and the qualifying transaction — prove it before building anything else.
5. Pin toolchain (`nightly-2026-01-01`), confirm `casper-js-sdk` v5 + TransactionV1 path; reject any v2-era snippet.

## 14. Success criteria

**Qualify gate (de-facto, confirmed on the live rules page):** working prototype on Casper Testnet with ≥1 transaction-producing on-chain component + open-source repo + demo video. Met by the qualifier scope above.

**Jury-criteria mapping (Final Round):** Real-World Applicability — RWA servicing, bullseye. Innovation — verification-not-attestation + cashflow-out. Use of AI/Agentic — autonomous decision loop with a real refuse-to-act branch. Working Smart Contracts — `ServicerVault` on testnet. Long-Term Launch — credible product (invoice financing) with a real adapter roadmap.

## 15. Honesty & disclosure (stated plainly in the README)

- Off-chain "cashflow arrived" evidence is **mocked/sandboxed** in the demo; the verifiers are stand-ins for real payment-rail adapters. The innovation is the **verification-gated autonomous release**, not the data source.
- Testnet only; the payout token is a test CEP-18, not a real stablecoin.
- The Casper x402 stack is weeks old; we pin versions and document what we hit.

## 16. Open questions / to validate during the Day-1 spike

- Exact testnet faucet payout amount and whether one account gives enough gas headroom for contract installs (~372 CSPR seen in one worked example — measure).
- Real per-install gas cost on current testnet.
- Sponsored-facilitator quota under the buildathon program (vs. the free 25/month).
- Exact request/response shape of the hosted (API-key-gated) facilitator and the precise EIP-712 payload Casper expects.
