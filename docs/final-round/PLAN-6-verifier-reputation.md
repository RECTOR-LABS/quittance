# PLAN-6 — On-Chain Verifier Reputation (execution)

> **Execution plan for SPEC-6** (`docs/final-round/SPEC-6-verifier-reputation.md`). Implements task-by-task.
> **For the executor:** `- [ ]` checkboxes track progress — tick as each completes. If any task fails acceptance, stop and flag — don't push a broken step.
> **Workbranch:** `feat/spec-1-receipts` (continuing — campaign branch; nothing merges to `main` until the whole campaign is tested + RECTOR confident). Commits land here as focused units.
> **SPEC-6 sign-off:** ✅ approved. **This PLAN:** draft for lightweight sign-off (task order) — proceeding to implementation per RECTOR's "ok go".

---

## Goal (mirror of SPEC-6 §1)

Give each verifier a queryable on-chain reputation (cycles seen / voted / agreed), scored **inside `distribute()` from data the contract already holds** — zero agent/adapter change, zero ABI change. Reputation is informational (never gates fund release); the quorum stays signature-based (SPEC-4, untouched). The unique moat.

## Global constraints (carry into every task)

- **Chain/SDK:** Casper 2.0 `casper-test`, Odra 2.8.x, `casper-js-sdk` v5 (reject v2). No new host calls (uses only Odra APIs proven by SPEC-4).
- **Testnet only.** Secrets via per-repo `.env`. Frozen-`main`. Never `git add -A`. No AI attribution. 2-space indent.
- **Dashboard:** self-contained (next/react/react-dom/lucide-react only), Tailwind, Space Mono / IBM Plex Mono aesthetic, lucide icons (no Unicode emojis as icons).
- **Additive-only:** SPEC-6 writes happen *after* a successful distribute (alongside the Receipt, SPEC-1). It cannot break the proven happy/fraud paths.

## Files touched

```
contracts/src/servicer_vault.rs     # VerifierReputation, VerifierScoreSnapshot, registry storage + keys index,
                                   # register_asset seed, distribute scoring + snapshot, 2 read entrypoints, RP1–RP10
dashboard/lib/types.ts             # VerifierReputation + VerifierScoreSnapshot TS types
dashboard/lib/chain.ts             # liveVerifierRegistry() raw-RPC reader (fallback null, CI-safe)
dashboard/components/VerifierReputationCard.tsx (new)  # reputation panel
dashboard/components/DistributionReceiptCard.tsx       # "reputation at settlement" line per verifier
dashboard/**/*.test.*              # render + fallback tests
```

**Untouched (by design):** `packages/core/**`, `packages/adapters/**`, `agent/**` — SPEC-6 reuses the existing parallel-arrays `distribute()` ABI verbatim; the contract derives all reputation signal from `cfg.verifiers` + the already-passed `signers`/`verdicts`.

---

## Tasks

### T0 — Workbranch
- [ ] Confirm on `feat/spec-1-receipts`; SPEC-1 + SPEC-4 commits are the base. No new branch.
- **Acceptance:** `git log --oneline main..HEAD` shows the 8 campaign commits; `git status` clean.

### T1 — Contract: types + storage
- [ ] In `contracts/src/servicer_vault.rs`:
  - Add `#[odra::odra_type] VerifierReputation { pubkey: PublicKey, cycles_seen: u32, cycles_voted: u32, cycles_agreed: u32, last_verdict: Option<bool>, last_cycle: Option<String> }` (SPEC-6 §4.1).
  - Add `#[odra::odra_type] VerifierScoreSnapshot { signer: PublicKey, cycles_seen: u32, cycles_voted: u32, cycles_agreed: u32 }` (SPEC-6 §4.2).
  - Extend `Receipt` with `reputation_snapshot: Vec<VerifierScoreSnapshot>` (pre-increment — the track record brought to this cycle).
  - Add storage to `ServicerVault`: `verifier_registry: Mapping<PublicKey, VerifierReputation>` + `verifier_keys: Vec<PublicKey>` (first-seen index for iteration).
- **Acceptance:** `cd contracts && cargo build` compiles.
- **Commands:** `cd contracts && cargo build`

### T2 — Contract: `register_asset` seeds the registry
- [ ] At the end of `register_asset`, for each verifier in the passed list: if `verifier_registry.get(&v).is_none()`, create a zeroed entry AND push `v` to `verifier_keys` (idempotent — a verifier listed by multiple assets keeps one entry + one index slot).
- **Acceptance:** compiles; identity exists from registration (Casper example-#2 "verifiable on-chain identity").
- **Commands:** `cd contracts && cargo build`

### T3 — Contract: `distribute()` scoring + snapshot
- [ ] After the SPEC-4 quorum gate passes and the verified sets are computed (and **before** emitting `Distributed`), in this order:
  1. **Snapshot** — for each verifier in `cfg.verifiers`, read its current (pre-increment) registry entry into a `VerifierScoreSnapshot`; collect into `reputation_snapshot`.
  2. **Score** — for each verifier `v` in `cfg.verifiers`: load its entry; `cycles_seen += 1`; if `v` is among the verified signers (submitted a valid SPEC-4 signature) then `cycles_voted += 1`, set `last_verdict = Some(verdicts[i])`, `last_cycle = Some("{asset_id}:{cycle_id}")`, and if `verdicts[i] == true` then `cycles_agreed += 1`; persist.
  3. Store the Receipt with the pre-increment `reputation_snapshot`.
  4. Emit `Distributed` (unchanged).
- [ ] Need a verified-signer → verdict index lookup: build a `Vec<(PublicKey, bool)>` of verified signers + their verdicts during the SPEC-4 gate loop (already iterated), reuse for scoring.
- **Acceptance:** compiles; the existing 25 tests still pass (the scoring is additive — no gate/payout/idempotency change).
- **Commands:** `cd contracts && cargo odra test` → 25/25 green (no regression).

### T4 — Contract: read entrypoints
- [ ] Add `get_verifier_reputation(&self, pubkey: PublicKey) -> Option<VerifierReputation>`.
- [ ] Add `get_verifier_registry(&self) -> Vec<VerifierReputation>` (iterate `verifier_keys`, collect non-None entries — first-seen order).
- **Acceptance:** compiles; read-only, no gate, no revert.
- **Commands:** `cd contracts && cargo build`

### T5 — Contract: tests RP1–RP10
- [ ] Add to the `tests` module (reuse `vk`, `sign_one`, `signed_arrays`, `funded_vault`, `assert_revert`):
  - **RP1** `register_asset` seeds zeroed entries — `get_verifier_reputation(vk)` returns `Some` with all-zero counts for each of the 3 registered verifiers.
  - **RP2** happy distribute (3 yes): all 3 get `seen+1, voted+1, agreed+1`; `last_verdict == Some(true)`.
  - **RP3** 2 yes + 1 valid-signed no (quorum met): all 3 `seen+1`; 2 yes `voted+1 agreed+1`; 1 no `voted+1 agreed+0`, `last_verdict == Some(false)`.
  - **RP4** 2 yes + 1 non-responder (only 2 signers submitted): all 3 `seen+1`; 2 responders `voted+1 agreed+1`; non-responder `voted+0 agreed+0`, `last_verdict` unchanged.
  - **RP5** `get_verifier_reputation` returns accumulated stats; `get_verifier_registry` lists all 3 in first-seen order.
  - **RP6** `Receipt.reputation_snapshot` == registry state **before** this cycle's increment (pre-increment counts).
  - **RP7** halted/fraud cycle (1 yes → `QuorumNotMet` revert) does **not** update any reputation (the honest-limitation proof).
  - **RP8** two sequential successful distributes accumulate (`cycles_seen == 2` etc.).
  - **RP9** a verifier shared across two assets has **one** accumulating entry (global registry, cross-asset).
  - **RP10** an unregistered-but-validly-signing pubkey (rejected by SPEC-4) is **not** scored; its reputation stays `None`; distribute still succeeds if registered quorum met.
- **Acceptance:** `cargo odra test` → 35/35 green (25 existing + 10 new). RP6 + RP7 are the design-critical proofs.
- **Commands:** `cd contracts && cargo odra test`

### T6 — Dashboard: TS types + chain reader
- [ ] In `dashboard/lib/types.ts`: add `VerifierReputation` + `VerifierScoreSnapshot` interfaces mirroring the contract types; extend `DistributionReceipt` with `reputationSnapshot: VerifierScoreSnapshot[]`.
- [ ] In `dashboard/lib/chain.ts`: add `liveVerifierRegistry(contractHash)` raw-RPC `query_state` read (same pattern as `liveDistributionReceipt`); force-dynamic + try-catch fallback returning null (CI-safe). CLValue decode wires at the bundled deploy (T9-style gate); returns null gracefully until then.
- **Acceptance:** types align with the contract; reader is null-safe; no v2 API.
- **Commands:** `pnpm --filter @quittance/dashboard test` (existing tests stay green).

### T7 — Dashboard: `VerifierReputationCard` + receipt-card extension
- [ ] New `VerifierReputationCard.tsx`: one row per verifier (label, truncated pubkey, `seen`/`voted`/`agreed`, response-rate %, accuracy %, last-verdict badge). Space Mono aesthetic, lucide icons. Sourced from `get_verifier_registry()`.
- [ ] Extend `DistributionReceiptCard.tsx`: a compact "reputation at settlement" line per verifier from `reputation_snapshot` (pre-increment counts), framed "the track record each verifier brought to this cycle."
- [ ] Honest copy: "reputation tracks settled cycles; halted cycles don't score (the contract can't authoritatively establish ground truth without settlement)."
- **Acceptance:** renders all fields; no new deps; Tailwind only; `pnpm --filter @quittance/dashboard build` green.
- **Commands:** `pnpm --filter @quittance/dashboard build`

### T8 — Dashboard tests
- [ ] Unit-test the `VerifierReputationCard` render (all fields + ratio derivation) + the `liveVerifierRegistry` fallback (registry unreadable → graceful null, no crash) + the receipt-card extension.
- **Acceptance:** `pnpm --filter @quittance/dashboard test` green (19 existing + new).
- **Commands:** `pnpm --filter @quittance/dashboard test`

### T9 — Full workspace verify
- [ ] `cd contracts && cargo odra test` — all green (35).
- [ ] `pnpm --recursive test` — all TS packages green (128 — core/adapters/agent unchanged by design; dashboard grows).
- [ ] `pnpm --filter @quittance/dashboard build` — CI-safe.
- [ ] `tsc` strict — no new errors.
- **Acceptance:** everything green; no regression vs the SPEC-4 baseline.

### T10 — Commit on the workbranch (no merge)
- [ ] Focused commits per layer (`feat(contracts): on-chain verifier reputation (SPEC-6)`, `feat(dashboard): verifier reputation panel (SPEC-6)`) — explicit staging, GPG-signed, conventional, no AI attribution.
- **Acceptance:** clean history on `feat/spec-1-receipts`; `main` untouched.

---

## Deferred (bundled with SPEC-1 + SPEC-4)
- **Testnet deploy + new hash** — one redeploy carrying SPEC-1 + SPEC-4 + SPEC-6; on-chain smoke (registry readable; reputation accumulates across two settles; halted cycle leaves registry unchanged). Update BUIDL contract address.
- **Merge to `main`** — only when the whole campaign is tested + RECTOR confident.

---

## Done (SPEC-6 code) = contract scores verifier reputation on-chain · RP1–RP10 green · dashboard renders the reputation panel + receipt snapshot · full workspace green · committed on the branch.

**Next after PLAN-6:** the bundled testnet deploy (SPEC-1+4+6 → new hash + e2e smoke), then SPEC-5 (agentic brief), then SPEC-3 (positioning + interactive demo).

---

*Tick boxes as you go. If any task fails acceptance, stop and flag — don't push a broken step.*