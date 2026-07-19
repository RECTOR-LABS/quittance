# PLAN-1 — Queryable On-Chain Receipts (execution)

> **Execution plan for SPEC-1** (`docs/final-round/SPEC-1-receipts.md`). Implements task-by-task.
> **For the executor:** implement via superpowers executing-plans. Steps use `- [ ]` checkboxes for tracking — tick as each completes.
> **Base:** `main` @ `3de5142`. **Discipline:** frozen-`main` — this whole plan lands as ONE feature branch → PR → CI green → merge small. Do not push to `main` directly.
> **SPEC-1 sign-off:** ✅ approved. **This PLAN:** draft for RECTOR's lightweight sign-off (confirm task order + T9 deploy decision) before T0.

---

## Goal (mirror of SPEC-1 §1)

Turn the `Distributed` event into queryable on-chain state: a stored `Receipt` per `(asset_id, cycle_id)`, a `get_receipt` read entrypoint, and a dashboard render. **No change to the quorum gate, payout math, idempotency, or trust boundary.**

## Global constraints (carry into every task)

- **Chain/SDK:** Casper 2.0 `casper-test`, TransactionV1, Odra 2.8.x (`nightly-2026-01-01`), `casper-js-sdk` v5 (never v2 — reject `CasperClient`/`install`/`callEntrypoint`), x402 `PAYMENT-SIGNATURE` header.
- **Testnet only.** No real funds. Secrets via per-repo `.env` (gitignored, symlinked to `~/Documents/secret/quittance/.env`).
- **Frozen-`main`:** branch → CI green (build + tests + dashboard build + CodeQL) → merge small. Never `git add -A`.
- **Style:** 2-space indent, meaningful names, comments only for non-obvious logic, TS `strict: true`. No AI attribution.
- **Dashboard:** self-contained (no internal workspace deps), Tailwind, Space Mono / IBM Plex Mono receipt aesthetic, `lucide-react` icons (no Unicode emojis as icons).

## Files touched

```
contracts/src/servicer_vault.rs        # Receipt type, receipts mapping, populate, get_receipt, tests R1–R6
dashboard/lib/chain.ts                # receipt reader (v5 dict-read, fallback)
dashboard/components/ (new)           # Receipt component
dashboard/app/{issuer,holder}/...     # render the receipt
dashboard/**/*.test.*                 # render + fallback tests
```

---

## Tasks

### T0 — Branch
- [ ] From `main` @ `3de5142`: `git checkout -b feat/spec-1-receipts`
- **Acceptance:** clean branch off `main`; `git status` clean.

### T1 — Contract: `Receipt` type + storage field
- [ ] In `contracts/src/servicer_vault.rs`:
  - Add `#[odra::odra_type] pub struct Receipt { ... }` per SPEC-1 §3 (`asset_id, cycle_id, settled_at: u64, total_distributed, dust_retained, holder_count, quorum_required, signers, verdict_hashes`).
  - Add `receipts: Mapping<String, Receipt>,` to the `ServicerVault` module struct (alongside `assets`, `pools`, `distributed`).
- **Acceptance:** `cd contracts && cargo build` compiles. Type + field defined.
- **Commands:** `cd contracts && cargo build`

### T2 — Contract: populate `Receipt` in `distribute()` (no logic change)
- [ ] In `distribute()`, insert between current step 7 (`self.distributed.set(&key, true);`) and step 8 (`self.env().emit_event(...)`):
  ```rust
  self.receipts.set(&key, Receipt {
      asset_id: asset_id.clone(),
      cycle_id: cycle_id.clone(),
      settled_at: self.env().get_block_time(),   // Odra 2.8.1 confirmed; _secs() variant available
      total_distributed: paid,
      dust_retained: pool - paid,                 // already computed; currently re-stored to pools
      holder_count: cfg.holders.len() as u32,
      quorum_required: cfg.quorum,
      signers: distinct_registered.clone(),       // already computed (quorum proof)
      verdict_hashes: verdict_hashes.clone(),
  });
  ```
- **Acceptance:** the existing 12 tests still pass unchanged (proves no logic change to gate/payout/idempotency).
- **Commands:** `cd contracts && cargo odra test` → 12/12 green.

### T3 — Contract: `get_receipt` read entrypoint
- [ ] Add to the `ServicerVault` impl:
  ```rust
  pub fn get_receipt(&self, asset_id: String, cycle_id: String) -> Option<Receipt> {
      let key = format!("{asset_id}:{cycle_id}");
      self.receipts.get(&key)
  }
  ```
- **Acceptance:** compiles; read-only, no gate, no revert.
- **Commands:** `cd contracts && cargo build`

### T4 — Tests R1–R6 (SPEC-1 §6)
- [ ] Add to the `tests` module in `servicer_vault.rs`:
  - **R1** `get_receipt` returns `None` before distribute.
  - **R2** after happy distribute, `get_receipt` mirrors the event (`total`, `signers`, `verdict_hashes`, `holder_count`, `quorum_required`).
  - **R3** `dust_retained` == `pool - paid` (pairs with existing dust test #12).
  - **R4** under-quorum revert leaves **no** receipt (no phantom receipts).
  - **R5** idempotent re-distribute does **not** overwrite (first receipt final; `AlreadyDistributed` fires first).
  - **R6** distinct cycles → distinct receipts (`(a,c1)` ≠ `(a,c2)`).
- [ ] Use the existing `vk()`/`hash()`/`assert_revert()` helpers + `env.get_event(&vault, n)` for R2.
- **Acceptance:** `cargo odra test` → 18/18 green (12 existing + 6 new).
- **Commands:** `cd contracts && cargo odra test`

### T5 — Dashboard: receipt reader
- [ ] In `dashboard/lib/chain.ts`: add a `getReceipt(vaultHash, assetId, cycleId)` reader using the existing v5 dictionary-read pattern (same file already reads balances). Force-dynamic + try-catch fallback (mirror `holder/page.tsx`).
- **Acceptance:** typed reader; no v2 API; handles missing receipt gracefully.
- **Note:** confirm exact v5 dict-read call against the existing `lib/chain.ts` (repo gotcha #1 — reject v2).

### T6 — Dashboard: Receipt component + render
- [ ] New `Receipt` component (Space Mono / IBM Plex Mono aesthetic): cycle id, settled time, total distributed, quorum proof (signers + verdict hashes), dust retained. `lucide-react` icons only.
- [ ] Render in issuer + holder views.
- **Acceptance:** renders all Receipt fields; no new deps; Tailwind only.
- **Commands:** `pnpm --filter @quittance/dashboard build`

### T7 — Dashboard tests (render + fallback)
- [ ] Unit-test the Receipt render (all fields) + the chain-read fallback (receipt absent → graceful UI, no crash).
- **Acceptance:** `pnpm --filter @quittance/dashboard test` green (13 existing + new).
- **Commands:** `pnpm --filter @quittance/dashboard test`

### T8 — Full workspace verify
- [ ] `pnpm --recursive test` — all TS packages green.
- [ ] `pnpm --recursive build` — all build.
- [ ] `cd contracts && cargo odra test` — 18/18.
- [ ] `pnpm --filter @quittance/dashboard build` — CI-safe (force-dynamic + fallback).
- [ ] `tsc` strict — no new errors.
- **Acceptance:** everything green; `main`-comparable or better.

### T9 — Deploy decision + execution (PRD Q7)
- [ ] **Decide:** new vault deploy (storage layout changed → new contract hash) **vs** Odra package upgrade (same package hash, new version). Confirm the idiomatic path.
- [ ] If **new deploy:** deploy to `casper-test` (faucet-funded key), capture the new contract hash, then update the BUIDL page via "Manage Submission" (contract address field) + note in README.
- [ ] If **upgrade:** verify the upgrade preserves `assets`/`pools`/`distributed` state; hash stable on BUIDL page.
- **Acceptance:** decision documented; receipt readable on-chain from a real testnet cycle (run the e2e `run-cycle.mjs happy` + `get_receipt` query).

### T10 — PR + merge (small)
- [ ] `gh pr create` (or `/git:create-pr` skill) — `feat/spec-1-receipts` → `main`, conventional `feat(contracts): queryable on-chain receipts (SPEC-1)`.
- [ ] CI green (build + 121→127 tests + dashboard build + CodeQL).
- [ ] `gh pr merge --merge --delete-branch`; `git branch -d` local.
- **Acceptance:** merged to `main`; `main` green; BUIDL page current.

---

## Done = `main` green + receipt queryable on-chain + dashboard renders it.

**Next after PLAN-1:** SPEC-4 (on-chain signature verification — spike GREEN) → PLAN-4 → implement. Then SPEC-6 (the moat).

---

*Tick boxes as you go. If any task fails acceptance, stop and flag — don't push a broken step to merge.*
