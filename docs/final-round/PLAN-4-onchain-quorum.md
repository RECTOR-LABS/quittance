# PLAN-4 — On-Chain Signature Verification (execution)

> **Execution plan for SPEC-4** (`docs/final-round/SPEC-4-onchain-quorum.md`). Implements task-by-task.
> **For the executor:** superpowers executing-plans; `- [ ]` checkboxes track progress.
> **Workbranch:** `feat/spec-1-receipts` (continuing — this is the campaign branch; nothing merges to `main` until the whole thing is tested + you're confident). Commits land here as focused units.
> **SPEC-4 sign-off:** ✅ approved (canonical-scheme change + clean-break V8). **This PLAN:** draft for lightweight sign-off (task order) before T1.

---

## Goal (mirror of SPEC-4 §1)

Move the quorum on-chain: `distribute()` verifies each Ed25519 verdict signature via `env().verify_signature`, counts valid distinct registered yes-votes, and distributes only if ≥ quorum. Servicer key alone can no longer release funds. L0 → L3.

## Global constraints (carry into every task)

- **Chain/SDK:** Casper 2.0 `casper-test`, TransactionV1, Odra 2.8.x, `casper-js-sdk` v5 (reject v2), x402 `PAYMENT-SIGNATURE`.
- **Signing:** Ed25519. The repo's x402 path already round-trips Casper-format Ed25519 (gotcha #3) — reuse that.
- **Testnet only.** Secrets via per-repo `.env`. Frozen-`main` (branch → green → merge only when confident). Never `git add -A`. No AI attribution.
- **Dashboard:** self-contained (next/react/react-dom/lucide-react only), Tailwind, Space Mono aesthetic.

## Files touched

```
packages/core/src/sign.ts           # canonicalBytes (binary) + sign/verify over bytes
packages/core/src/sign.test.ts      # adapt to the binary scheme
contracts/src/servicer_vault.rs     # SignedVerdict, VerifierSignature, Receipt ext, distribute verify, canonical_bytes, tests V1–V10
packages/adapters/src/casper-js-chain-client.ts   # encode signed_verdicts in distribute
agent/src/servicer.ts               # pass SignedVerdict[] through (not yesSigners)
dashboard/components/DistributionReceiptCard.tsx  # "verified on-chain" affordance
```

---

## Tasks

### T0 — Workbranch
- [ ] Confirm on `feat/spec-1-receipts`; pull SPEC-1's two commits as the base. No new branch.
- **Acceptance:** `git log --oneline main..HEAD` shows the two SPEC-1 commits.

### T1 — `core/sign.ts`: binary canonical scheme
- [ ] Replace `canonicalHash(v) -> Hash` with `canonicalBytes(v) -> Uint8Array` per SPEC-4 §4 (u16-BE length-prefix, fixed field order `assetId, cycleId, verdict, observedAmount, source`, verdict = 1 byte).
- [ ] `signVerdict` signs `canonicalBytes(v)` directly (drop the SHA-256-over-JSON); `verifyVerdict` verifies over the same bytes.
- [ ] Update `sign.test.ts` (≈13 tests): determinism + sign→verify round-trip against the new bytes; keep the exhaustiveness guard.
- **Acceptance:** `pnpm --filter @quittance/core test` green; `canonicalBytes` is deterministic across runs.
- **Commands:** `pnpm --filter @quittance/core test`

### T2 — Contract: `SignedVerdict` + `VerifierSignature` + `Receipt` extension
- [ ] In `contracts/src/servicer_vault.rs`: add `#[odra::odra_type] SignedVerdict { asset_id, cycle_id, verdict: bool, observed_amount, source, signature: Bytes, signer: PublicKey }` (SPEC-4 §5.1).
- [ ] Add `VerifierSignature { signer, verdict, signature: Bytes }`; extend `Receipt` with `verifier_signatures: Vec<VerifierSignature>` (SPEC-4 §5.2).
- **Acceptance:** `cd contracts && cargo build` compiles.
- **Commands:** `cd contracts && cargo build`

### T3 — Contract: `canonical_bytes` + `distribute()` verification
- [ ] Add `fn canonical_bytes(sv: &SignedVerdict) -> Bytes` reconstructing SPEC-4 §4 identically to the TS side (`len.to_be_bytes() ++ field.as_bytes() ++ …`, verdict byte).
- [ ] Replace `distribute()`'s signature: `(asset_id, cycle_id, signed_verdicts: Vec<SignedVerdict>)` — **remove** `verdict_hashes` + `signers` (clean break, V8).
- [ ] Replace the quorum gate (current step 3) with: for each `sv` → bind (`asset_id`/`cycle_id` match) + registered (`cfg.verifiers.contains(signer)`) + `env().verify_signature(&canonical_bytes(sv), &sv.signature, &sv.signer)`; count valid distinct-signer **yes** votes; revert `QuorumNotMet` if `< quorum`.
- [ ] Populate `verifier_signatures` (the verified set) into the Receipt (SPEC-1's write site).
- **Acceptance:** `cargo build` compiles; the `Distributed` event still carries the (now verified) `signers`.
- **Commands:** `cd contracts && cargo build`

### T4 — Contract: tests V1–V10 + adapt existing distribute tests
- [ ] Add a `sign_as(seed, sv_fields) -> SignedVerdict` test helper: derive `SecretKey::ed25519_from_bytes([seed;32])`, build `canonical_bytes`, sign with the `ed25519` crate (dev-dep) → real Ed25519 `Signature` → `Bytes`. (Mirrors how the agent signs off-chain.)
- [ ] **Adapt the existing distribute tests** (8 happy/fraud/idempotency/dust tests + SPEC-1 R2/R3/R5/R6) to call `distribute(..., signed_verdicts)` instead of `(verdict_hashes, signers)`.
- [ ] Add the security matrix:
  - **V1** 3 valid yes → distributes, 3 verified sigs in Receipt
  - **V2** exact-quorum (2)
  - **V3** sub-quorum (1) → `QuorumNotMet`, no Receipt
  - **V4** forged signature → not counted; below quorum → revert
  - **V5** replay (sig bound to c1, distribute c2) → skipped
  - **V6** unregistered signer (valid sig) → skipped
  - **V7** collusion (same pubkey twice) → counted once
  - **V8** old `(verdict_hashes, signers)` call → not callable (compile-time: signature removed)
  - **V9** validly-signed "no" verdict → vote but not yes
  - **V10** Receipt.signers == cryptographically-verified set
- **Acceptance:** `cargo odra test` — all green (adapted existing + V1–V10). V4–V7 are the security proofs.
- **Commands:** `cd contracts && cargo odra test`

### T5 — Agent adapter: encode `signed_verdicts`
- [ ] In `casper-js-chain-client.ts`: change the `distribute` arg branch from `{ verdict_hashes, signers }` to `{ signed_verdicts: Vec<SignedVerdict> }` (CLValue list of structs — confirm the struct CLType mapping, PRD/SPEC Q-adapter-encoding).
- [ ] Update the adapter's unit tests (the `casper-js-chain-client.test.ts` encode cases).
- **Acceptance:** `pnpm --filter @quittance/adapters test` green.
- **Commands:** `pnpm --filter @quittance/adapters test`

### T6 — Agent: pass `SignedVerdict[]` through
- [ ] In `servicer.ts`: stop extracting `quorum.yesSigners` (line 175) — pass the full `verdicts: SignedVerdict[]` to the chain client's `distribute`.
- [ ] Update `servicer.test.ts` (26 tests) for the new call shape; keep the cycle state-machine coverage.
- **Acceptance:** `pnpm --filter @quittance/agent test` green.
- **Commands:** `pnpm --filter @quittance/agent test`

### T7 — Dashboard: "signatures verified on-chain" affordance
- [ ] In `DistributionReceiptCard.tsx`: render the `verifier_signatures` (signer + verdict + truncated sig) with the ShieldCheck, framed "the contract verified each signature." Extend the `DistributionReceipt` TS type + the `distributionReceiptForCycle` helper accordingly.
- [ ] Test the new render.
- **Acceptance:** `pnpm --filter @quittance/dashboard test` + `build` green.
- **Commands:** `pnpm --filter @quittance/dashboard test && pnpm --filter @quittance/dashboard build`

### T8 — Full workspace verify
- [ ] `cd contracts && cargo odra test` — all green.
- [ ] `pnpm --recursive test` — all TS packages green.
- [ ] `pnpm --filter @quittance/dashboard build` — CI-safe.
- [ ] `tsc` strict — no new errors.
- **Acceptance:** everything green; no regression vs the SPEC-1 baseline.

### T9 — Commit on the workbranch (no merge)
- [ ] Focused commits per layer (`feat(core)`, `feat(contracts)`, `feat(adapters)`, `feat(dashboard)`) — explicit staging, GPG-signed, conventional, no AI attribution.
- **Acceptance:** clean history on `feat/spec-1-receipts`; `main` untouched.

---

## Deferred (bundled with SPEC-1)
- **Testnet deploy + new hash** — one redeploy carrying SPEC-1 + SPEC-4 (+ SPEC-6 later); on-chain smoke (`run-cycle.mjs` with signed verdicts; forged-sig rejected on testnet).
- **Merge to `main`** — only when the whole campaign is tested + you're confident.

---

## Done (SPEC-4 code) = contract verifies Ed25519 on-chain · V1–V10 green · agent passes signed verdicts · dashboard shows "verified" · full workspace green · committed on the branch.

**Next after PLAN-4:** SPEC-6 (verifier reputation — the unique moat) → PLAN-6 → implement → bundle the testnet deploy.

---

*Tick boxes as you go. If any task fails acceptance, stop and flag — don't push a broken step.*
