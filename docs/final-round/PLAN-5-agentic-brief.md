# PLAN-5 — Agentic Verification Brief (execution)

> **Execution plan for SPEC-5** (`docs/final-round/SPEC-5-agentic-brief.md`). Implements task-by-task.
> **For the executor:** `- [ ]` checkboxes track progress — tick as each completes. If any task fails acceptance, stop and flag.
> **Workbranch:** `feat/spec-1-receipts` (continuing; nothing merges to `main` until the whole campaign is tested + RECTOR confident).
> **SPEC-5 sign-off:** ✅ approved (on-chain String storage; separate `record_brief` entrypoint; servicer-key gate via register_asset caller; AI reasons, chain decides).

---

## Goal (mirror of SPEC-5 §1)

After a cycle settles, the agent's LLM writes a short human-readable verification brief, recorded on-chain alongside the receipt, queryable from the dashboard. Closes the "Agentic AI" rubric gap. The AI is load-bearing for **explanation**, never for **decision** — the quorum stays signature-based (SPEC-4).

## Global constraints (carry into every task)

- **Chain/SDK:** Casper 2.0 `casper-test`, Odra 2.8.x, `casper-js-sdk` v5. No new host calls.
- **LLM:** `ANTHROPIC_API_KEY` or `OLLAMA_HOST` per AGENTS.md (narration only; decisions stay deterministic). Node 20+ global `fetch` — no new npm dep for the LLM client.
- **Testnet only.** Secrets via per-repo `.env`. Frozen-`main`. Never `git add -A`. No AI attribution. 2-space indent.
- **Dashboard:** self-contained (next/react/react-dom/lucide-react only), Tailwind, Space Mono aesthetic, lucide icons.
- **Additive:** `distribute()` ABI unchanged; the brief is a post-hoc write gated to settled cycles. LLM failures are best-effort (cycle still settles).

## Files touched

```
contracts/src/servicer_vault.rs     # briefs mapping, servicer_key, record_brief, get_brief, errors, B1–B6
packages/core/src/brief-client.ts  # BriefClient seam (interface) — NEW
packages/core/src/fakes.ts         # FakeBriefClient (deterministic, test-only)
packages/core/src/index.ts         # export BriefClient + FakeBriefClient
agent/src/llm-brief-client.ts      # LlmBriefClient (fetch-based, Anthropic/Ollama, env-gated) — NEW
agent/src/servicer.ts              # briefClient dep; call brief + record_brief post-settle; CycleOutcome.brief
agent/src/servicer.test.ts          # A1–A4
dashboard/lib/types.ts             # (no change — brief is a string)
dashboard/lib/chain.ts             # liveBrief() reader (fallback null, CI-safe)
dashboard/lib/data.ts              # briefForCycle() committed-ledger fallback (deterministic template)
dashboard/components/DistributionReceiptCard.tsx  # brief block
dashboard/components/DistributionReceiptCard.test.tsx
dashboard/lib/chain.test.ts        # liveBrief fallback
```

**Untouched:** `packages/adapters/**` (the `record_brief` call goes through the existing `callEntrypoint` seam — no new adapter code; the args are primitives).

---

## Tasks

### T0 — Workbranch
- [ ] Confirm on `feat/spec-1-receipts`; SPEC-1/4/6 commits are the base. No new branch.
- **Acceptance:** `git log --oneline main..HEAD` shows the 11 campaign commits; `git status` clean (modulo persistent noise).

### T1 — Contract: storage + errors + servicer-key capture
- [ ] Add `briefs: Mapping<String, String>` + `servicer_key: Var<Address>` to the `ServicerVault` module struct.
- [ ] Add errors: `BriefAlreadyRecorded = 10`, `CycleNotSettled = 11`, `BriefTooLong = 12`, `NotServicer = 13`.
- [ ] In `register_asset`: on the first call, if `servicer_key` is unset, set it to `self.env().caller()` (the asset registrar is the servicer in the single-operator demo; documented as the production-governance gap).
- **Acceptance:** `cd contracts && cargo build` compiles.
- **Commands:** `cd contracts && cargo build`

### T2 — Contract: `record_brief` + `get_brief`
- [ ] `record_brief(asset_id, cycle_id, brief: String)`: (a) caller == servicer_key else `NotServicer`; (b) receipt exists for the key else `CycleNotSettled`; (c) brief not already set else `BriefAlreadyRecorded`; (d) `brief.len() <= 1024` else `BriefTooLong`; (e) set.
- [ ] `get_brief(asset_id, cycle_id) -> Option<String>` (read-only, no gate, no revert).
- **Acceptance:** compiles; `distribute()` ABI unchanged.
- **Commands:** `cd contracts && cargo build`

### T3 — Contract: tests B1–B6
- [ ] **B1** `get_brief` None before record.
- [ ] **B2** record after a settled cycle → `get_brief` returns it.
- [ ] **B3** record for an unsettled cycle → `CycleNotSettled`.
- [ ] **B4** record twice → `BriefAlreadyRecorded` (first is final).
- [ ] **B5** record by a non-servicer key → `NotServicer`.
- [ ] **B6** record over 1024 bytes → `BriefTooLong`.
- [ ] Reuse `funded_vault` + `happy_evidence` + `assert_revert`; the servicer key is the `register_asset` caller (account 0 in `funded_vault`).
- **Acceptance:** `cargo odra test` → 41/41 green (35 existing + 6 new).
- **Commands:** `cd contracts && cargo odra test`

### T4 — Core: `BriefClient` seam + `FakeBriefClient`
- [ ] `packages/core/src/brief-client.ts`: `BriefClient` interface (`brief(opts): Promise<string>`).
- [ ] `packages/core/src/fakes.ts`: `FakeBriefClient` — deterministic templated brief from the opts (assetId, cycleId, verdicts, distributed, reputationSnapshot). Records calls for test introspection.
- [ ] Export both from `packages/core/src/index.ts`.
- **Acceptance:** `pnpm --filter @quittance/core build` + `test` green.
- **Commands:** `pnpm --filter @quittance/core test`

### T5 — Agent: `LlmBriefClient` (real, env-gated)
- [ ] `agent/src/llm-brief-client.ts`: fetch-based; if `ANTHROPIC_API_KEY` → Anthropic messages API; elif `OLLAMA_HOST` → Ollama `/api/chat`; else throw. Fixed prompt (deterministic structure: "explain, don't decide"). Returns the brief string.
- [ ] No new npm dep (Node 20+ global `fetch`).
- **Acceptance:** compiles; not exercised in unit tests (env-gated; the fake is used there).
- **Commands:** `pnpm --filter @quittance/agent build`

### T6 — Agent: `runCycle` calls brief + `record_brief` post-settle
- [ ] `ServicerDeps` gains `briefClient: BriefClient`.
- [ ] After a successful `distribute` (step 5), call `briefClient.brief(...)`; on success, `chainClient.callEntrypoint(vaultHash, "record_brief", { asset_id, cycle_id, brief })`. Wrap in try/catch — LLM/record failure does NOT change the cycle outcome (best-effort).
- [ ] `CycleOutcome` gains `brief?: string`.
- [ ] Halted cycles: no brief call, no record (parity with no-receipt-on-halt).
- **Acceptance:** `pnpm --filter @quittance/agent test` — adapt the 26 existing + add A1–A4.
- **Commands:** `pnpm --filter @quittance/agent test`

### T7 — Agent: tests A1–A4
- [ ] **A1** successful distribute → `briefClient.brief` called → `record_brief` called with the brief.
- [ ] **A2** LLM throws → cycle still settles, `record_brief` NOT called, outcome `distributed`.
- [ ] **A3** halted cycle → no `brief` call, no `record_brief`.
- [ ] **A4** `CycleOutcome.brief` populated on success.
- [ ] Use `FakeBriefClient` + `FakeChainClient` (existing test harness).
- **Acceptance:** `pnpm --filter @quittance/agent test` green (26 adapted + 4 new).
- **Commands:** `pnpm --filter @quittance/agent test`

### T8 — Dashboard: `liveBrief` reader + `briefForCycle` fallback + brief block
- [ ] `dashboard/lib/chain.ts`: `liveBrief(contractHash, assetId, cycleId)` — raw-RPC `query_state` against `briefs` named key; null gracefully until the bundled deploy (same T9-deferred pattern).
- [ ] `dashboard/lib/data.ts`: `briefForCycle(cycle)` — deterministic committed-ledger fallback (a templated explanation of the cycle's verdicts + outcome; the fraud cycle explains the halt).
- [ ] `DistributionReceiptCard.tsx`: a "AI verification brief" block rendering the brief (lucide `Sparkles`/`FileText` icon), with honest copy ("AI-generated explanation of the cryptographically verified record; the brief reasons, the chain decides").
- **Acceptance:** `pnpm --filter @quittance/dashboard build` green.
- **Commands:** `pnpm --filter @quittance/dashboard build`

### T9 — Dashboard tests
- [ ] **D1** receipt card renders the brief when present.
- [ ] **D2** omits the brief block when absent.
- [ ] **D3** `liveBrief` returns null gracefully (fallback) + on RPC error + when fetch throws.
- [ ] `chain.test.ts` + `DistributionReceiptCard.test.tsx` (+ fixture gains `reputationSnapshot` already present from SPEC-6).
- **Acceptance:** `pnpm --filter @quittance/dashboard test` green.
- **Commands:** `pnpm --filter @quittance/dashboard test`

### T10 — Full workspace verify
- [ ] `cd contracts && cargo odra test` — 41 green.
- [ ] `pnpm --recursive test` — all TS green (core +agent +4, dashboard +3).
- [ ] `pnpm --filter @quittance/dashboard build` — CI-safe.
- [ ] `tsc` strict — no new errors.
- **Acceptance:** everything green; no regression vs the SPEC-6 baseline (172 → ~179).

### T11 — Commit on the workbranch (no merge)
- [ ] Focused commits: `feat(contracts): agentic verification brief (SPEC-5)`, `feat(core,agent): brief client + runCycle integration (SPEC-5)`, `feat(dashboard): AI verification brief render (SPEC-5)`, `docs(final-round): SPEC-5 + PLAN-5`.
- **Acceptance:** clean history on `feat/spec-1-receipts`; `main` untouched.

---

## Deferred (bundled with SPEC-1 + SPEC-4 + SPEC-6)
- **Testnet deploy + new hash** — one redeploy carrying SPEC-1/4/5/6; on-chain smoke (brief readable after a settle; absent after a halt).
- **Merge to `main`** — RECTOR's gate.

---

## Done (SPEC-5 code) = contract records the AI brief on-chain · B1–B6 + A1–A4 + D1–D3 green · agent calls LLM + record_brief post-settle (best-effort) · dashboard renders the brief honestly · full workspace green · committed on the branch.

**Next after PLAN-5:** the bundled testnet deploy (SPEC-1+4+5+6), then SPEC-3 (positioning + interactive demo).

---

*Tick boxes as you go. If any task fails acceptance, stop and flag.*