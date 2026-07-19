# PLAN-3 — Positioning, Launch & Interactive Demo (execution)

> **Execution plan for SPEC-3** (`docs/final-round/SPEC-3-positioning-demo.md`). Implements task-by-task.
> **Workbranch:** `feat/spec-1-receipts` (continuing; nothing merges to `main` until the campaign is tested + RECTOR confident).
> **SPEC-3 sign-off:** ✅ approved (guided client-side walkthrough, not a live trigger; README/ROADMAP; deploy-dependent tail folded into unit #8).

---

## Goal (mirror of SPEC-3 §1)

A hands-on `/demo` where a judge drives the fraud attack and watches the chain refuse (surfacing SPEC-4/5/6), a post-campaign README + landing rewrite (lead message + x402 + example-#2), and a `ROADMAP.md` for the "is this real?" question. Closes the last red rubric gap (Long-Term Launch Plans).

## Global constraints
- **Dashboard:** self-contained (next/react/react-dom/lucide-react only), Tailwind, Space Mono aesthetic, lucide icons (no Unicode emojis as icons). No new deps.
- **No contract/agent change** — SPEC-3 is presentation + one client component. Frozen-`main`. Never `git add -A`. No AI attribution.
- **Honest framing:** the demo is a guided walkthrough of the real on-chain logic over the testnet-proven cycle (disclosed on-page), not a live trigger.

## Files touched

```
dashboard/components/TryTheFraudDemo.tsx        # NEW — client component, state machine
dashboard/components/TryTheFraudDemo.test.tsx   # NEW — T1–T5
dashboard/app/demo/page.tsx                    # mount the interactive demo above the video
dashboard/app/page.tsx                         # hero sub-line upgrade + x402 surface
README.md                                      # post-SPEC-4/5/6 rewrite
ROADMAP.md                                     # NEW — Long-Term Launch Plans
```

---

## Tasks

### T0 — Workbranch
- [ ] Confirm on `feat/spec-1-receipts`; SPEC-1/4/5/6 commits are the base.
- **Acceptance:** `git log --oneline main..HEAD` shows the 15 campaign commits.

### T1 — `TryTheFraudDemo` client component
- [ ] New `dashboard/components/TryTheFraudDemo.tsx` (`'use client'`): state machine `idle → scenario → attack → refusal → contrast → why` via `useState`.
- [ ] **scenario panel:** the RWA framing (tokenized invoice `inv-001` → 2 investors → a servicing cycle due → 3 verifiers about to be queried).
- [ ] **attack button:** "Compromise a verifier — submit a fake 'paid' claim" → advances to refusal; visualize the compromised verifier flipping to "yes."
- [ ] **refusal panel:** the fraud cycle's 3 verdicts (reuse `VerdictCard`) + `QuorumGate` (1/3 → NOT MET) + the four consequences with lucide icons: no receipt (SPEC-1), no payout (holders unchanged), reputation unchanged (SPEC-6 — halted cycles don't score), no brief (SPEC-5). "See the happy contrast" button → contrast.
- [ ] **contrast panel:** the happy cycle side-by-side (3 yes → MET → reuse `QuorumGate` + `DistributionReceiptCard` + `VerifierReputationCard` + the brief). "Why" button → why.
- [ ] **why panel:** the thesis in plain language + a link to the source/contract.
- [ ] **honest copy** on-page: "a guided walkthrough of the real on-chain logic over the testnet-proven cycle… not a simulation of a different system."
- [ ] Data: `getAsset()`, `getCycles()`, `distributionReceiptForCycle`, `verifierRegistryFromCommitted`, `briefForCycle` (committed-ledger; no live RPC).
- **Acceptance:** `pnpm --filter @quittance/dashboard build` green.
- **Commands:** `pnpm --filter @quittance/dashboard build`

### T2 — Mount on `/demo`
- [ ] `dashboard/app/demo/page.tsx`: render `TryTheFraudDemo` above the existing video. Keep the video + links.
- **Acceptance:** `/demo` builds; the interactive demo is the first thing on the page.

### T3 — Tests T1–T5
- [ ] New `dashboard/components/TryTheFraudDemo.test.tsx`:
  - **T1** state transitions render each panel.
  - **T2** the attack button advances → refusal (compromised "yes" + quorum NOT MET).
  - **T3** the refusal panel shows all four properties (no receipt / no payout / reputation unchanged / no brief).
  - **T4** the contrast panel shows the happy cycle's receipt + payout + reputation + brief.
  - **T5** the honest copy is present.
- [ ] Use `@testing-library/react` + `userEvent` (or `fireEvent.click`) for the button-driven transitions.
- **Acceptance:** `pnpm --filter @quittance/dashboard test` green.
- **Commands:** `pnpm --filter @quittance/dashboard test`

### T4 — Landing hero + x402 surface
- [ ] `dashboard/app/page.tsx`: upgrade the hero sub-line to the post-campaign lead ("the contract verifies the quorum on-chain · verifiers carry reputation · the AI explains · the chain decides"). Add a one-line x402 surface in the AssetHeader area or hero ("verifiers paid per-call over x402, settled on Casper").
- **Acceptance:** build green; the lead message reflects SPEC-4/5/6.

### T5 — README rewrite (post-SPEC-4/5/6)
- [ ] Update `README.md`:
  - Lead message → "the contract verifies the quorum on-chain; verifiers carry on-chain reputation; the AI explains — the chain decides."
  - Add the **depth ladder** (L0 qualifier → L3 SPEC-4, strongest in field, code-verified) — compact table.
  - Add the **moat stack** (SPEC-1/4/6/5) one line each + honest limitations.
  - Add **x402 emphasis** subsection (67% of prize; native use; real settlement txs — deploy-dependent tail marked TBD).
  - Add **example-#2 mapping** subsection.
  - Expand **Honesty & disclosure** (mocked evidence; reputation = settled cycles only; brief = narration not proof).
  - Keep the existing structure (problem/insight/how it works/proven on-chain/see it live/architecture/layout/run/honesty/license); update the "how it works" step 4 to mention on-chain sig verify + reputation + brief.
- **Acceptance:** README renders; no broken internal anchors; honest.

### T6 — `ROADMAP.md`
- [ ] New top-level `ROADMAP.md`: Now (final-round) → Next (~Q1: real rail, multi-asset) → Then (~Q2: marketplace w/ staking/slashing, verifier independence, real RWA pilot) → Mainnet (~Q3: audited, real funds) → Vision (reputation network for RWA servicing). Plus a "real project" framing section + project socials placeholder.
- **Acceptance:** `ROADMAP.md` exists; credible; honest about the demo's current limits.

### T7 — Full workspace verify
- [ ] `pnpm --recursive test` — all TS green (dashboard +5).
- [ ] `pnpm --filter @quittance/dashboard build` — CI-safe.
- **Acceptance:** everything green; no regression vs the SPEC-5 baseline (187 → ~192).

### T8 — Commit on the workbranch (no merge)
- [ ] Focused commits: `feat(dashboard): interactive "try the fraud" demo (SPEC-3)`, `docs: post-campaign README + ROADMAP (SPEC-3)`, `docs(final-round): SPEC-3 + PLAN-3`.
- **Acceptance:** clean history on `feat/spec-1-receipts`; `main` untouched.

---

## Deferred (deploy-dependent tail — unit #8, RECTOR's gate)
- README contract hashes + BUIDL sample txs + live-demo pointer → fold in when the bundled testnet deploy lands.

---

## Done (SPEC-3 code/copy) = interactive demo on /demo · T1–T5 green · README + ROADMAP post-campaign · landing lead upgraded · full workspace green · committed on the branch.

**Next after PLAN-3:** the bundled testnet deploy (units #8 + the SPEC-3 tail), then merge to `main`. That's the whole campaign.

---

*Tick boxes as you go. If any task fails acceptance, stop and flag.*