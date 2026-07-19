# PLAN-2 — Stripe Rail Adapter (implementation plan)

> **Implements:** `docs/final-round/SPEC-2-stripe-rail.md`. TDD, small slices, green-between.
> **Branch:** `feat/spec-2-stripe`. **Base:** `main` (9f07413). **No merge without RECTOR's approval** (Jul 26 deadline).
> **Scope:** one package (`verifiers/`) + `.env.example` + README + ROADMAP. **No contract change. No redeploy. No BUIDL-page change.**

---

## Slice breakdown (each: write test → implement → green → commit)

### Slice A — `stripeCashflowSource` factory + payment-index loader
**Files:** `verifiers/src/stripe-cashflow-source.ts` (+ `loadStripePaymentIndex`), `verifiers/src/stripe-cashflow-source.test.ts` (S10 malformed-index fail-fast, S9 index miss → null).
- Define `StripeSourceConfig { apiKey, paymentIndex, fetchImpl? }` + `StripePaymentIndexEntry { paymentIntentId, expectedAmount }`.
- `loadStripePaymentIndex(path)`: read + JSON.parse + validate (object; each entry has non-empty `paymentIntentId` + integer-string `expectedAmount`); throw on malformed (fail-fast). Mirrors `fileCashflowSource`'s `loadFixture`.
- `stripeCashflowSource({ apiKey, paymentIndex, fetchImpl })` → `CashflowSource`. `fetch(assetId, cycleId)`: index miss → `null`; else (defer to slice B for the HTTP call — here just the lookup + a placeholder that returns null).
- Tests S9 (miss → null), S10 (malformed throws). Green.

### Slice B — Stripe HTTP call + the success path
**Files:** same, add tests S1, S2, S11.
- Implement the `fetch` to `GET https://api.stripe.com/v1/payment_intents/{id}` with `Authorization: Bearer ${apiKey}`.
- On non-2xx → `null` (logged). On 2xx → parse `{ status, amount, metadata }`.
- If `status !== "succeeded"` → `null` (logged). If `metadata?.reference` missing → `null`. Else build `CashflowEvidence { assetId, cycleId, expectedAmount: index.expectedAmount, observedAmount: String(amount), reference: metadata.reference }`.
- Inject `fetchImpl` (default global `fetch`). Tests S1 (paid + ref + amount ≥ → evidence; `decide` → yes), S2 (short → evidence; decide → no), S11 (fake fetch asserts `Authorization` header + URL path).
- Green.

### Slice C — Conservative-failure paths
**Files:** same, add tests S3, S4, S5, S6, S7, S8.
- S3: `succeeded` + no `metadata.reference` → null. S4: `succeeded` + wrong ref → evidence with wrong ref; `decide` → no. S5: `processing`/`requires_action`/`canceled` → null. S6: 404 → null. S7: 401 → null. S8: fetch rejects → null.
- All `null`-paths log a non-leaky message server-side (no secret).
- Green.

### Slice D — `serve.ts` wiring + `.env.example`
**Files:** `verifiers/src/serve.ts`, `.env.example`.
- Extract `buildSource()` (see SPEC §7). `VERIFIER_SOURCE` selector; default `file` (backward-compatible). `stripe` → `stripeCashflowSource` from `STRIPE_API_KEY` + `STRIPE_PAYMENT_INDEX_PATH`.
- `.env.example`: add the 3 new vars under the verifier section, commented (optional unless `VERIFIER_SOURCE=stripe`).
- No new test for `serve.ts` (it's env-wiring; the source itself is fully tested in A–C). Manual: confirm `VERIFIER_SOURCE=file` (default) still starts; `VERIFIER_SOURCE=stripe` with valid keys starts; missing stripe vars fail-fast.
- Green (full verifier suite: 30 existing + 11 new = 41).

### Slice E — README + ROADMAP + honesty disclosure
**Files:** `README.md`, `ROADMAP.md`.
- README honesty section: "one verifier reads Stripe test mode (`sk_test_...`); the other two read mocked fixtures; the quorum is untouched. Stripe test mode uses no real money." Update the L0→L3 ladder's S2 line (now closed by SPEC-2).
- ROADMAP: SPEC-2 row → ✅ shipped (was "optional").
- No code change; docs commit.

### Slice F — branch push + PR (held for merge)
- Push branch, open PR (conventional `feat(verifiers):` scope, signed, no AI attribution).
- CI green (Build&test + CodeQL + Vercel).
- **STOP. Do not merge.** Surface to RECTOR with the PR link + the two asks (merge approval + Stripe test key for live e2e).

---

## Live e2e (deferred — needs RECTOR's Stripe test key)

After Slice F, when RECTOR provides `sk_test_...`:
1. Create a test PaymentIntent: `stripe payment_intents create --amount 1000 --currency usd --metadata reference=INV-001` (or via Dashboard test mode). Confirm `status: succeeded` (test-mode cards: `4242 4242 4242 4242`).
2. Build a `stripe-payments.json` index mapping `"inv-001:happy" → { paymentIntentId, expectedAmount: "1000" }`.
3. Start the Stripe-backed verifier: `VERIFIER_SOURCE=stripe STRIPE_API_KEY=sk_test_... STRIPE_PAYMENT_INDEX_PATH=./verifiers/stripe-payments.json VERIFIER_SIGNING_KEY_HEX=... ...`
4. Hit `GET /verify?asset=inv-001&cycle=happy` (paid) → expect signed "yes" verdict.
5. Flip the PI to `canceled` (or point the index at a non-succeeded PI) → expect "no".
6. Optionally: run the full `run-cycle happy` e2e with one verifier in `stripe` mode + two in `file` mode → quorum met → distribute. (This also exercises the x402 path; if the v2 x402 loose end bites, fall back to direct-distribute as the v2 proof did.)

---

## Verify-before-merge checklist (per the dependabot/verify-then-adopt discipline)

- [ ] `pnpm --filter @quittance/verifier test` → 41/41 green (30 existing + 11 new).
- [ ] `pnpm --recursive test` → 151 + 11 = 162 green (no regression in core/agent/adapters/dashboard).
- [ ] `pnpm --filter @quittance/dashboard build` → clean.
- [ ] `tsc` clean across the workspace.
- [ ] No new npm dependency added (built-in `fetch` only).
- [ ] `git diff main..feat/spec-2-stripe -- contracts/` → empty (contract untouched; no redeploy).
- [ ] `.env.example` updated; no secret in the diff.
- [ ] README + ROADMAP honest about the one-rail scope.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Live e2e blocked on RECTOR's key | Unit tests (incl. S11 header assertion) cover correctness; live e2e is the bonus-on-the-bonus, not a gate. |
| v2 x402 loose end resurfaces in live e2e | Fall back to direct-distribute (the v2 proof path); the Stripe source is independent of the x402 path. |
| Stripe API shape drift | The source reads only `status`, `amount`, `metadata.reference` — stable, documented Stripe API fields (years-stable). |
| Unit confusion (motes vs cents) | Disclosed (SPEC §6); each source self-consistent; quorum gates on yes/no, not amounts. |
| Main churn during review window | Branch only; merge held for RECTOR's explicit approval. |

---

*TDD, small slices, green-between. Each slice is a separate signed commit. No `git add -A` (explicit paths). No AI attribution.*