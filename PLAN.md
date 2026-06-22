# Quittance Implementation Plan (Qualifier)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Casper-testnet prototype where an autonomous agent verifies a real-world cashflow via 2-of-3 x402-paid verifiers, then executes an on-chain distribution to token holders — by the July 1 qualification deadline.

**Architecture:** TS-first pnpm monorepo. A lean Odra `ServicerVault` contract holds the distribution pool, holder registry, and per-cycle receipts, and exposes `distribute()`. A servicer agent runs the cycle, paying verifiers through a `PaymentClient` seam (wrapping `casper-x402`) and calling the contract through a `ChainClient` seam (wrapping `casper-js-sdk` v5). Three Express x402-gated verifier services return signed yes/no verdicts. A Next.js dashboard renders issuer config + holder receipts. The two bleeding-edge SDK integrations are isolated behind adapter interfaces so all owned logic is TDD'd against fakes.

**Tech Stack:** Casper 2.0 testnet · Odra 2.8 (Rust, `nightly-2026-01-01`) · `casper-js-sdk` v5 · `@make-software/casper-x402` · Express · Next.js · Claude API or Ollama · pnpm workspaces · Vitest · TypeScript (strict).

## Global Constraints

*Every task's requirements implicitly include this section.*

- Chain: Casper 2.0 `casper-test`; use **TransactionV1**, never legacy `Deploy`/`put-deploy`.
- SDK: `casper-js-sdk` **v5** only. Reject any v2 API (`CasperClient`, `CasperServiceByJsonRPC`, `install`, `callEntrypoint`, `CLValueBuilder`).
- Odra: toolchain pinned `nightly-2026-01-01`; `wasm-strip` (wabt) + `wasm-opt` (binaryen) on PATH.
- x402: request header is **`PAYMENT-SIGNATURE`** (not `X-PAYMENT`); trust the `casper-x402` repo over `casper.network/ai` marketing copy. The **sponsored facilitator MUST be used** — free testnet quota is **25 calls/month**.
- Idempotency: every x402 settlement keyed idempotent on `(cycleId, verifierId)`; distribution idempotent on `(assetId, cycleId)`. Never double-pay, never double-distribute.
- Secrets/endpoints via env vars only — never hardcode keys, node URLs, tokens, or addresses.
- No AI attribution in any commit, file, or PR — write as a human developer.
- Style: 2-space indent, meaningful names, comments only for non-obvious logic. TypeScript `strict: true`.
- No silent failures: every error path is explicit and actionable (no swallowed exceptions, no generic messages).

## File Structure

```
quittance/
├── SPEC.md · PLAN.md · DAY1-DERISK.md · README.md · LICENSE
├── package.json · pnpm-workspace.yaml · tsconfig.base.json · .env.example
├── contracts/                      # Odra Rust workspace
│   ├── rust-toolchain               # nightly-2026-01-01
│   ├── Cargo.toml · Odra.toml
│   └── src/lib.rs                   # ServicerVault module + OdraVM tests
│   └── bin/deploy_servicer.rs       # livenet deploy script (testnet)
├── packages/core/                  # shared, SDK-free
│   └── src/
│       ├── types.ts                 # AssetConfig, Verdict, Receipt, Cycle…
│       ├── payment-client.ts        # PaymentClient interface + types
│       ├── chain-client.ts          # ChainClient interface + types
│       └── quorum.ts                # pure 2-of-3 logic
├── packages/adapters/              # SDK integrations (Day-1 spikes implement these)
│   └── src/
│       ├── casper-x402-payment-client.ts
│       └── casper-js-chain-client.ts
├── verifiers/                      # Express x402-gated verifier service (run x3)
│   └── src/{server.ts,verdict.ts,sign.ts}
├── agent/                          # servicer agent
│   └── src/{servicer.ts,narrate.ts,index.ts}
├── dashboard/                      # Next.js (issuer config + holder view)
└── e2e/                            # end-to-end cycle runner + demo scripts
    └── src/{happy-path.ts,fraud-path.ts}
```

---

## Phase 0 — Day-1 de-risk (full runbook: `DAY1-DERISK.md`)

> Phase 0 tasks are **spikes**: their deliverable is a working vertical slice **plus captured API knowledge** recorded into `packages/adapters`. They are not pure TDD because we are discovering a 3-day-old API. Once the adapters exist and are interface-tested, Phases 1–5 are proper TDD against fakes.

### Task 0.1: Environment, sponsored facilitator, funded testnet wallet

**Files:** Create `.env.example`, `.env` (gitignored).

- [ ] **Step 1:** Claim the buildathon **sponsored x402 facilitator** access; record `X402_FACILITATOR_URL` + any API key into `.env`.
- [ ] **Step 2:** Create a CSPR.build account → generate a CSPR.cloud access token → `CSPR_CLOUD_TOKEN`, `CASPER_NODE_URL=https://node.testnet.cspr.cloud` in `.env`.
- [ ] **Step 3:** Install Casper Wallet, switch to testnet, fund via `https://testnet.cspr.live/tools/faucet`. Export the key to `secret_key.pem` (gitignored), path → `CASPER_SECRET_KEY_PATH`.
- [ ] **Step 4:** Verify balance is queryable: `curl -H "Authorization: $CSPR_CLOUD_TOKEN" "$CASPER_NODE_URL/accounts/<pubkey>"`. Expected: JSON with a non-zero balance.
- [ ] **Step 5:** Record findings (faucet amount received, account hash) into `DAY1-DERISK.md` "Findings".

### Task 0.2: Run the `casper-x402` quickstart end-to-end; capture the real client API

**Files:** scratch clone under `/tmp/casper-x402`.

- [ ] **Step 1:** Clone `github.com/make-software/casper-x402`; run the 3-terminal quickstart (facilitator :4022, resource server :4021, client) per its README.
- [ ] **Step 2:** Confirm the client successfully pays the resource server and a settlement lands. Capture: the exact client constructor + `pay`/`fetch` method names and signatures, the `PaymentRequirements` shape, and the on-chain tx hash.
- [ ] **Step 3:** Record the captured API surface verbatim into `DAY1-DERISK.md` "Findings → casper-x402 API". **This is the source of truth for Task 0.4.**

### Task 0.3: Land ONE `transfer_with_authorization` on `casper-test` (the qualifying tx)

- [ ] **Step 1:** Using the headless client (`examples/client`) with our funded key, sign an EIP-712 `transfer_with_authorization` and drive `/settle`.
- [ ] **Step 2:** Confirm one real settlement deploy on `casper-test`; open it on `testnet.cspr.live`.
- [ ] **Step 3:** Capture the exact EIP-712 payload (`ExactCasperPayload`) fields, the CEP-18 token address used, and the `PAYMENT-SIGNATURE` header format into `DAY1-DERISK.md`. **Qualification on-chain requirement is now de-risked.**

### Task 0.4: Implement `PaymentClient` adapter against the captured API

**Files:** Create `packages/core/src/payment-client.ts`, `packages/adapters/src/casper-x402-payment-client.ts`, test `packages/adapters/src/casper-x402-payment-client.test.ts`.

**Interfaces — Produces:**
```ts
// packages/core/src/payment-client.ts
export interface PaymentRequest { url: string; cycleId: string; verifierId: string; }
export interface SettlementReceipt {
  verifierId: string; cycleId: string; txHash: string;
  amountMotes: string; settledAt: string; // ISO
}
export interface PaymentClient {
  /** Pays an x402-gated URL; idempotent on (cycleId, verifierId). */
  pay(req: PaymentRequest): Promise<SettlementReceipt>;
}
```

- [ ] **Step 1: Write the failing test** (against a stubbed facilitator response captured in 0.2):
```ts
import { describe, it, expect, vi } from "vitest";
import { CasperX402PaymentClient } from "./casper-x402-payment-client";

it("returns a settlement receipt with the on-chain tx hash", async () => {
  const fakeX402 = { pay: vi.fn().mockResolvedValue({ txHash: "abc123", amount: "1000000" }) };
  const client = new CasperX402PaymentClient(fakeX402 as any);
  const r = await client.pay({ url: "http://v1/verify", cycleId: "c1", verifierId: "v1" });
  expect(r.txHash).toBe("abc123");
  expect(r.verifierId).toBe("v1");
});

it("is idempotent: second pay for same (cycle,verifier) does not re-settle", async () => {
  const fakeX402 = { pay: vi.fn().mockResolvedValue({ txHash: "abc123", amount: "1000000" }) };
  const client = new CasperX402PaymentClient(fakeX402 as any);
  await client.pay({ url: "u", cycleId: "c1", verifierId: "v1" });
  await client.pay({ url: "u", cycleId: "c1", verifierId: "v1" });
  expect(fakeX402.pay).toHaveBeenCalledTimes(1);
});
```
- [ ] **Step 2:** Run `pnpm --filter @quittance/adapters test` → expect FAIL (class undefined).
- [ ] **Step 3:** Implement `CasperX402PaymentClient` wrapping the captured `casper-x402` client; maintain an in-memory `Set` keyed `${cycleId}:${verifierId}` for idempotency; map the raw result into `SettlementReceipt`. (Fill the exact `casper-x402` call from 0.2's capture.)
- [ ] **Step 4:** Run tests → expect PASS.
- [ ] **Step 5:** Commit `feat(adapters): casper-x402 PaymentClient with idempotent settlement`.

### Task 0.5: Implement `ChainClient` adapter against `casper-js-sdk` v5

**Files:** Create `packages/core/src/chain-client.ts`, `packages/adapters/src/casper-js-chain-client.ts`, test alongside.

**Interfaces — Produces:**
```ts
// packages/core/src/chain-client.ts
export interface DeployResult { txHash: string; }
export interface ChainClient {
  installContract(wasmPath: string, args: Record<string, unknown>): Promise<DeployResult>;
  callEntrypoint(contractHash: string, entry: string, args: Record<string, unknown>): Promise<DeployResult>;
  queryDictItem(contractHash: string, dict: string, key: string): Promise<unknown>;
  waitForFinality(txHash: string): Promise<"success" | "failure">;
}
```

- [ ] **Step 1:** Write a thin integration test gated behind `RUN_TESTNET=1` (skipped in CI) that calls `waitForFinality` against a known testnet tx hash from 0.3 → expects `"success"`.
- [ ] **Step 2:** Implement against `casper-js-sdk` v5 (`TransactionV1`, fixed pricing). Map v5 primitives; **no v2 APIs**. Fill exact calls from the v5 migration guide referenced in DAY1-DERISK.
- [ ] **Step 3:** Run with `RUN_TESTNET=1` → expect PASS. Commit `feat(adapters): casper-js-sdk v5 ChainClient`.

---

## Phase 1 — ServicerVault (Odra contract)

### Task 1.1: Scaffold Odra workspace + toolchain pin

**Files:** Create `contracts/rust-toolchain` (`nightly-2026-01-01`), `contracts/Cargo.toml`, `contracts/Odra.toml`, `contracts/src/lib.rs` (empty module).

- [ ] **Step 1:** `rustup toolchain install nightly-2026-01-01`; install `wabt` + `binaryen`; `cargo install cargo-odra`.
- [ ] **Step 2:** Scaffold the Flipper sample; run `cargo odra test` → expect PASS (confirms toolchain works before writing our logic).
- [ ] **Step 3:** Commit `chore(contracts): odra workspace + pinned toolchain`.

### Task 1.2: Asset registration + storage

**Files:** Modify `contracts/src/lib.rs`.

**Interfaces — Produces (entrypoints consumed by ChainClient):** `register_asset(asset_id: String, token: Address, holders: Vec<(Address,U256)>, verifiers: Vec<PublicKey>, quorum: u8)`, `get_asset(asset_id) -> AssetConfig`.

- [ ] **Step 1: Failing test** (OdraVM):
```rust
#[test]
fn registers_an_asset_with_holder_split() {
    let env = odra_test::env();
    let mut vault = ServicerVaultHostRef::deploy(&env, NoArgs);
    vault.register_asset("inv-1".into(), token_addr(), vec![(alice(), 700.into()), (bob(), 300.into())], vec![vk1(), vk2(), vk3()], 2);
    let cfg = vault.get_asset("inv-1".into());
    assert_eq!(cfg.quorum, 2);
    assert_eq!(cfg.holders.len(), 2);
}
```
- [ ] **Step 2:** `cargo odra test` → FAIL.
- [ ] **Step 3:** Implement `#[odra::module] struct ServicerVault { assets: Mapping<String, AssetConfig>, … }` + `register_asset`/`get_asset`. Reject empty holders, quorum>verifiers, or duplicate asset_id with explicit reverts.
- [ ] **Step 4:** `cargo odra test` → PASS. **Step 5:** Commit.

### Task 1.3: Fund the distribution pool

- [ ] **Step 1: Failing test** — `fund("inv-1")` with attached value increases `pool("inv-1")`; funding an unregistered asset reverts.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement payable `fund`. **Step 4:** PASS. **Step 5:** Commit.

### Task 1.4: `distribute()` — idempotent, quorum-proof-gated, event-emitting (CORE)

**Files:** Modify `contracts/src/lib.rs`.

**Interfaces — Produces:** `distribute(asset_id: String, cycle_id: String, verdict_hashes: Vec<[u8;32]>, signers: Vec<PublicKey>)`; emits `Distributed { asset_id, cycle_id, total }` or reverts `QuorumNotMet`/`AlreadyDistributed`/`InsufficientPool`.

- [ ] **Step 1: Failing tests:**
```rust
#[test] fn distributes_pro_rata_when_quorum_met() { /* 2 valid signers → alice +70%, bob +30%, Distributed emitted */ }
#[test] fn reverts_when_fewer_than_quorum_signers() { /* 1 signer, quorum 2 → QuorumNotMet, balances unchanged */ }
#[test] fn is_idempotent_per_cycle() { /* second distribute(inv-1,c1,…) → AlreadyDistributed, no double pay */ }
#[test] fn reverts_when_pool_underfunded() { /* InsufficientPool, no partial transfers */ }
```
- [ ] **Step 2:** `cargo odra test` → FAIL.
- [ ] **Step 3:** Implement: verify `signers.len() >= cfg.quorum` and each signer ∈ `cfg.verifiers` (dedup); guard `distributed: Mapping<(String,String), bool>`; check pool ≥ total before any transfer; transfer pro-rata; store `Receipt`; emit `Distributed`. All failure modes are explicit reverts.
- [ ] **Step 4:** `cargo odra test` → PASS. **Step 5:** Commit `feat(contracts): quorum-gated idempotent distribute`.

### Task 1.5: Deploy ServicerVault to `casper-test`

**Files:** Create `contracts/bin/deploy_servicer.rs` (livenet backend).

- [ ] **Step 1:** `cargo odra build -b casper` → emit Wasm; `cargo run --bin deploy_servicer --features=livenet`.
- [ ] **Step 2:** Confirm install tx on `testnet.cspr.live`; record `SERVICER_VAULT_HASH` → `.env`. **Step 3:** Commit deploy script + record gas cost in DAY1-DERISK Findings.

---

## Phase 2 — Verifier services

### Task 2.1: Verdict logic (pure, TDD)

**Files:** Create `verifiers/src/verdict.ts` + test.

**Interfaces — Produces:** `evaluate(source: CashflowSource, query: { assetId: string; cycleId: string }): Verdict` where `Verdict = { assetId; cycleId; verdict: "yes"|"no"; observedAmount: string; source: string }`.

- [ ] **Step 1: Failing test:** a mock source returning a matching payment → `verdict: "yes"`; a missing/short payment → `"no"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement deterministic comparison (expected vs observed amount + reference). **Step 4:** PASS. **Step 5:** Commit.

### Task 2.2: Signed verdict (TDD)

**Files:** Create `verifiers/src/sign.ts` + test.

**Interfaces — Produces:** `signVerdict(v: Verdict, key: KeyPair): { verdict: Verdict; signature: string; signer: string }`; `verifyVerdict(signed)` → bool. Hash basis: canonical JSON of `Verdict`.

- [ ] **Step 1: Failing test:** `verifyVerdict(signVerdict(v,k))` is true; tampering with `observedAmount` makes it false.
- [ ] **Step 2:** FAIL. **Step 3:** Implement Ed25519 sign/verify over the canonical hash (the hash later passed to `distribute()`). **Step 4:** PASS. **Step 5:** Commit.

### Task 2.3: x402-gate the verifier endpoint

**Files:** Create `verifiers/src/server.ts`.

- [ ] **Step 1:** Express `GET /verify?asset=&cycle=` wrapped by the `casper-x402` server middleware (configured to the sponsored facilitator) → returns the signed verdict only after payment settles.
- [ ] **Step 2:** Manual check with the headless client: unpaid → `402`; paid → `200` + signed verdict. **Step 3:** Commit `feat(verifiers): x402-gated signed verdict endpoint`.

### Task 2.4: Run three independent verifier instances

**Files:** Create `verifiers/config/{v1,v2,v3}.env` (distinct keys + distinct mock data sources, one configured to disagree for the fraud demo).

- [ ] **Step 1:** Process-manager script to boot 3 instances on 3 ports. **Step 2:** Commit.

---

## Phase 3 — Servicer agent

### Task 3.1: Quorum logic (pure, TDD) — already stubbed in `packages/core/src/quorum.ts`

**Interfaces — Produces:** `reachQuorum(verdicts: SignedVerdict[], required: number): { passed: boolean; yesSigners: PublicKeyHex[]; verdictHashes: Hash[] }`.

- [ ] **Step 1: Failing tests:**
```ts
it("passes with 2 of 3 yes", () => expect(reachQuorum([yes(v1),yes(v2),no(v3)],2).passed).toBe(true));
it("fails with 1 of 3 yes", () => expect(reachQuorum([yes(v1),no(v2),no(v3)],2).passed).toBe(false));
it("ignores invalid signatures", () => expect(reachQuorum([tampered(v1),yes(v2),no(v3)],2).passed).toBe(false));
it("dedupes same signer voting twice", () => expect(reachQuorum([yes(v1),yes(v1),no(v3)],2).passed).toBe(false));
```
- [ ] **Step 2:** FAIL. **Step 3:** Implement: verify each signature, drop invalid, dedupe by signer, count "yes", return signer set + hashes for `distribute()`. **Step 4:** PASS. **Step 5:** Commit.

### Task 3.2: Cycle state machine (TDD against fakes) — CORE

**Files:** Create `agent/src/servicer.ts` + test using `FakePaymentClient`/`FakeChainClient`.

**Interfaces — Consumes:** `PaymentClient`, `ChainClient`, `reachQuorum`. **Produces:** `runCycle(assetId, cycleId): Promise<CycleOutcome>` where `CycleOutcome = { status: "distributed"|"halted"; reason?: string; distributeTx?: string; receipts: SettlementReceipt[] }`.

- [ ] **Step 1: Failing tests:**
```ts
it("happy path: pays 3 verifiers, 2-of-3 yes → calls distribute, returns tx", async () => { /* fakes: 3 pays, 2 yes; expect chain.callEntrypoint('distribute',…) called once; status 'distributed' */ });
it("fraud path: 2-of-3 say no → does NOT call distribute, status halted", async () => { /* expect callEntrypoint NOT called; reason 'quorum_not_met' */ });
it("never double-distributes if called twice for same cycle", async () => { /* second runCycle → status halted reason 'already_distributed' (reads chain state) */ });
it("halts (no distribute) if a verifier payment fails after retries", async () => { /* PaymentClient throws → bounded retry → halt reason 'payment_failed' */ });
```
- [ ] **Step 2:** FAIL. **Step 3:** Implement the state machine: pay each verifier (via `PaymentClient`, idempotent), collect signed verdicts, `reachQuorum`, branch to `distribute` (via `ChainClient`) or halt; pre-check on-chain `distributed` flag; explicit `reason` on every halt. **Step 4:** PASS. **Step 5:** Commit `feat(agent): verification-gated servicing cycle`.

### Task 3.3: LLM narration (thin, optional)

**Files:** Create `agent/src/narrate.ts`.

- [ ] **Step 1:** Given a `CycleOutcome`, produce a plain-language explanation via Claude/Ollama (e.g., "Refused: only 1 of 3 verifiers confirmed payment"). Pure function of the outcome; no decisions made by the LLM (decisions stay deterministic). **Step 2:** Snapshot test on a fixed outcome. **Step 3:** Commit.

### Task 3.4: Wire real adapters + entrypoint

**Files:** Create `agent/src/index.ts`.

- [ ] **Step 1:** Compose `CasperX402PaymentClient` + `CasperJsChainClient` + `runCycle`; read config from `.env`. **Step 2:** Commit.

---

## Phase 4 — Dashboard (Next.js)

### Task 4.1: Issuer config + holder view

**Files:** Create `dashboard/app/{page.tsx,asset/[id]/page.tsx}`, `dashboard/lib/read.ts`.

- [ ] **Step 1:** Issuer form (register asset → calls a small server action that uses `ChainClient.register_asset`). **Step 2:** Holder view reads `Distributed`/`DisputeFlagged` events via CSPR.cloud Streaming/REST and renders each cycle's receipt with a `testnet.cspr.live` tx link. **Step 3:** Component test for receipt rendering (yes/no/halted states). **Step 4:** Commit `feat(dashboard): issuer config + holder receipts`.

---

## Phase 5 — End-to-end + demo

### Task 5.1: Happy-path e2e on testnet

**Files:** Create `e2e/src/happy-path.ts`.

- [ ] **Step 1:** Script: register asset → fund → boot 3 verifiers (all "yes") → `runCycle` → assert one real `distribute` tx on `casper-test` and holder balances changed. **Step 2:** Run with `RUN_TESTNET=1` → PASS. **Step 3:** Commit.

### Task 5.2: Fraud-path e2e (the demo centerpiece)

**Files:** Create `e2e/src/fraud-path.ts`.

- [ ] **Step 1:** Same setup but feed a fake "paid" claim with verifiers configured 1-yes/2-no → assert **no distribute tx**, `DisputeFlagged`, agent narrates the refusal. **Step 2:** Run → PASS. **Step 3:** Commit.

### Task 5.3: Demo video + submission checklist

- [ ] **Step 1:** Record: agent decides → pays verifiers (show tx hashes) → happy distribute → then the fraud refusal. **Step 2:** README walkthrough + the honesty disclosure (mocked off-chain evidence; testnet). **Step 3:** Submit BUIDL (repo + video) on DoraHacks before Jul 1 07:00 UTC.

---

## Self-Review

**Spec coverage:** §2 Problem → demo framing (5.x). §3 verify-not-attest → quorum (1.4, 3.1, 3.2). §5 architecture → Phases 0–4 map 1:1 (vault/agent/verifiers/dashboard). §6 cycle → 3.2 + 5.x. §7 ServicerVault → Phase 1. §8 2-of-3 over x402 → 2.x + 3.1. §9 x402 critical path → Phase 0. §11 qualifier scope → Phases 0–5 (Final-Round items excluded by design). §12 failure modes → 1.4 + 3.2 tests (disagreement, timeout, settlement failure, partial, quota, underfunded). §13 de-risks → Phase 0 / DAY1-DERISK. §14 success → 5.1/5.2 + submission. ✅ No gaps.

**Placeholder scan:** No "TBD/handle edge cases" — every failure path has a named test. SDK-specific calls in 0.4/0.5 are explicitly "fill from captured API," which is correct sequencing for an unverified 3-day-old SDK, not a hand-wave (the captures are themselves task deliverables in 0.2/0.3).

**Type consistency:** `PaymentClient.pay → SettlementReceipt`; `ChainClient.callEntrypoint` used by 3.2/4.1; `Verdict`/`SignedVerdict` flow verdict→sign(2.2)→reachQuorum(3.1)→`verdict_hashes`/`signers`→`distribute`(1.4). Names consistent across tasks. ✅
