# SPEC-2 — Real Payment-Rail Adapter (Stripe test mode)

> **Workstream: the optional bonus** of the Final-Round campaign (see `PRD.md` §9, S2). Closes the *"verifiers read fake data"* soft spot by making **one** verifier read a **real external API** (Stripe test mode) instead of a local JSON fixture. Quorum, contract, and the other two verifiers are **untouched**.
> **Status:** Draft for RECTOR's sign-off. **No implementation until approved.**
> **Depends on:** nothing (purely additive to the verifier package; the `CashflowSource` seam already exists). **Unblocks:** nothing (independent bonus).
> **Risk:** LOW — additive to one verifier service; no contract change; no main churn required (branch only until RECTOR approves merge).

---

## 1. Goal

Replace **one** verifier's `fileCashflowSource` (JSON fixture) with a `stripeCashflowSource` that calls the **real Stripe test-mode API** to confirm a PaymentIntent `succeeded` with the expected amount + reference. The other two verifiers keep their mocked fixtures; the 2-of-3 quorum is untouched.

**North-Star link (PRD G6 / S2):** close soft spot **S2** ("the verifiers read fake data"). One verifier now reads a real rail. The innovation being demonstrated is the **verification-gated release over an independent external source**, not Stripe integration as a product — Stripe test mode is the stand-in for any real payment rail (bank API, Stripe, etc.), exactly as the README's honesty section already states.

---

## 2. Scope

**In:**
- New `stripeCashflowSource` factory in `verifiers/src/stripe-cashflow-source.ts` — implements the existing `CashflowSource` interface (`verdict.ts`).
- Injectable `fetch` (default global `fetch`) so the source is unit-testable **without** hitting Stripe.
- A JSON **payment index** mapping `"assetId:cycleId" → { paymentIntentId, expectedAmount }` (config — tells the source *which* PaymentIntent to check; the *payment status* comes from Stripe, not config).
- `serve.ts` wiring: a `VERIFIER_SOURCE` selector (`file` | `stripe`) + `STRIPE_API_KEY` + `STRIPE_PAYMENT_INDEX_PATH`. Backward-compatible (defaults to `file`).
- `.env.example` updates (verifier section) documenting the new vars.
- Unit tests: success/paid, success/not-paid, missing-metadata, 404, 401, network error, index miss → `null`, index malformed → fail-fast.
- README honesty section + ROADMAP update (SPEC-2 now shipped, not "optional").
- Dashboard: a small "real rail" badge on the verifier that reads Stripe (honest disclosure; no new deps).

**Out (explicitly fenced — PRD §8):**
- The other two verifiers on real rails (PRD: "SPEC-2 ships 1").
- Stripe **webhooks** / push notifications (the verifier pulls on demand; no always-on listener — matches the agent's low-frequency cycle).
- Any **contract** change (`ServicerVault` untouched — no redeploy, no BUIDL-page change).
- Any change to the **quorum**, payout math, or the agent's cycle state machine.
- A `stripe` npm dependency (use built-in `fetch`; keep the verifier package lean).
- Real money (test mode only — `sk_test_...` keys; no real charges).

---

## 3. Why PaymentIntent (resolves PRD Q8)

Stripe offers three candidate resources for "did the cashflow arrive?":

| Resource | `status` for "paid" | Carries amount? | Carries reference? | Fit |
|---|---|---|---|---|
| **PaymentIntent** | `succeeded` | yes (`amount`, smallest unit) | yes (`metadata.reference`) | ✅ canonical "did this payment succeed" |
| Charge | `succeeded` | yes | yes (`metadata`) | a layer below PI; PI is the modern primary |
| Invoice | `paid` | yes | yes (`metadata` / number) | billing-flow object (draft→open→paid); over-scoped for a cashflow-arrival check |

**Decision: PaymentIntent.** It is Stripe's canonical primitive for "a payment was collected"; `amount` + `metadata.reference` map cleanly onto `CashflowEvidence`; and creating a test PI is a single `stripe payment_intents create` call. The PRD's demo scenario (tokenized invoice → investors → payout) maps to: operator creates a test PI for the invoice amount, tags it with `metadata.reference = INV-001`, the Stripe-backed verifier confirms it `succeeded`.

---

## 4. Data flow

```
agent → GET /verify?asset=inv-001&cycle=happy   (pays verifier over x402)
          └─ runVerifier → source.fetch("inv-001","happy")
                └─ stripeCashflowSource:
                     1. lookup payment index["inv-001:happy"]
                        → { paymentIntentId: "pi_3...", expectedAmount: "1000" }
                     2. GET https://api.stripe.com/v1/payment_intents/pi_3...
                        Authorization: Bearer sk_test_...
                     3. if status !== "succeeded" → null (→ "no")
                     4. evidence = {
                          assetId, cycleId,
                          expectedAmount: index.expectedAmount,   // what we expect (config, in PI unit)
                          observedAmount: String(pi.amount),      // what Stripe says was paid (real)
                          reference: pi.metadata?.reference ?? null
                        }
          └─ decide(evidence, expectedReference):
                reference match && observed >= expected → "yes"
```

**The real-rail check is the Stripe API call.** The index only tells the source *which* PI to check; the *payment status, amount, and reference all come from Stripe*. A fixture can lie; a `succeeded` PaymentIntent in Stripe test mode is real settlement-rail state.

---

## 5. Conservative failure (the safety property)

A payment verifier must **never** report "yes" when it cannot confirm payment. `stripeCashflowSource` therefore returns `null` (→ the decision logic votes **"no"**) on **every** non-confirming path:

| Condition | Returns | Verifier votes |
|---|---|---|
| Index miss (cycle not mapped) | `null` | "no" |
| Index malformed | throws at construction (fail-fast) | (server won't start) |
| Stripe API network error | `null` (logged) | "no" |
| Stripe 401 / 403 (bad key) | `null` (logged) | "no" |
| Stripe 404 (PI id wrong) | `null` (logged) | "no" |
| Stripe 5xx | `null` (logged) | "no" |
| `status !== "succeeded"` (e.g. `processing`, `requires_action`, `canceled`) | `null` (logged) | "no" |
| `metadata.reference` missing | `null` (the PI doesn't carry the right invoice tag) | "no" |
| `status === "succeeded"` + ref present + amount ≥ expected | `CashflowEvidence` | "yes" (only path) |

**False-positive (release funds without payment) is impossible by construction.** False-negatives (transient Stripe outage → "no") are **safe**: the quorum fails → halt → funds withheld. The 2-of-3 design means one conservative "no" doesn't block a genuine cycle if the other two verifiers (in production: other real rails) confirm — but for the demo, 2 mocked + 1 real means a Stripe outage drops the quorum to 2/3 (the two mocked fixtures still say yes → distribute). That is the **intended** quorum behavior, not a bug: the design tolerates one verifier being unavailable. (In production the other two would be independent real rails; the demo's honesty disclosure covers this.)

Errors are **logged server-side** (actionable, non-leaky — no secret in the log) and **never** crash the verifier process: the route's existing last-resort handler + the `null`-return contract keep the service up.

---

## 6. Units (honest disclosure)

Each `CashflowSource` sets `evidence.expectedAmount` and `evidence.observedAmount` in **its own unit**:
- `fileCashflowSource`: motes (CSPR smallest unit, 10⁹/CSPR) — matches the contract's pool.
- `stripeCashflowSource`: the Stripe account's smallest currency unit (cents for USD).

`decide()` compares `observed` ≥ `expected` **within** a single evidence record — it does **not** compare amounts across verifiers. The contract's `distribute()` gates on the **yes/no quorum** of signed verdicts (SPEC-4), not on cross-verifier amount consistency. So the Stripe-backed verifier's evidence being in cents while the file-backed verifiers' is in motes is **correct and intended**: each verifier independently answers "did the cashflow arrive *on its rail*?" in that rail's native unit.

**Demo convention:** the operator creates the test PaymentIntent with `amount` (cents) equal to the `expectedAmount` configured in the payment index for that cycle (treating the number as the contract). The README discloses this is a demo unit convention, not an FX rate. A production deployment would convert (or the asset would be denominated in the rail's unit); out of scope here.

---

## 7. Wiring (`serve.ts`)

Add a source selector, backward-compatible (default `file`):

```ts
function buildSource(): CashflowSource {
  const kind = (process.env.VERIFIER_SOURCE ?? "file").trim();
  if (kind === "file") {
    return fileCashflowSource(requireEnv("VERIFIER_EVIDENCE_PATH"));
  }
  if (kind === "stripe") {
    return stripeCashflowSource({
      apiKey: requireEnv("STRIPE_API_KEY"),
      paymentIndex: loadStripePaymentIndex(requireEnv("STRIPE_PAYMENT_INDEX_PATH")),
    });
  }
  throw new Error(`unknown VERIFIER_SOURCE "${kind}" (expected "file" or "stripe")`);
}
```

Then `verifier.source = buildSource()` instead of the inline `fileCashflowSource(...)`. No other change to `serve.ts`. The x402 gate, signing, route, and payment config are identical for both source kinds — the source is a pure seam.

**New env vars** (all optional when `VERIFIER_SOURCE=file`):
- `VERIFIER_SOURCE` — `file` (default) | `stripe`.
- `STRIPE_API_KEY` — `sk_test_...` (test mode only; never `sk_live_...`).
- `STRIPE_PAYMENT_INDEX_PATH` — path to the payment index JSON.

**Secrets:** `STRIPE_API_KEY` lives in the per-repo `.env` (gitignored, symlinked to `~/Documents/secret/quittance/.env`), never in the repo, never logged.

---

## 8. Payment index format

A JSON object mapping cycle keys to Stripe PaymentIntent lookups:

```json
{
  "inv-001:happy": {
    "paymentIntentId": "pi_3Oabc...",
    "expectedAmount": "1000"
  }
}
```

- `paymentIntentId` — the test-mode PI to verify (`pi_...`).
- `expectedAmount` — integer string, in the PI's smallest unit (cents), the amount the operator expects was paid. Compared (≥) against `pi.amount`.

Malformed index (not an object, missing `paymentIntentId`, non-integer `expectedAmount`) → **fail-fast at server startup** (consistent with `fileCashflowSource`'s `loadFixture` discipline). Unknown cycle keys → `null` at runtime (→ "no"), not an error.

---

## 9. Tests (`verifiers/src/stripe-cashflow-source.test.ts`, additive)

| # | Case | Asserts |
|---|---|---|
| S1 | PI `succeeded` + ref match + amount ≥ expected | returns evidence; `decide` → "yes" |
| S2 | PI `succeeded` + ref match + amount < expected | returns evidence; `decide` → "no" (short payment) |
| S3 | PI `succeeded` but `metadata.reference` missing | returns `null` → "no" (the PI doesn't carry the invoice tag) |
| S4 | PI `succeeded` but `metadata.reference` mismatch | returns evidence with the wrong ref; `decide` → "no" |
| S5 | PI `processing` / `requires_action` / `canceled` | returns `null` → "no" |
| S6 | Stripe 404 (PI id wrong) | returns `null` → "no" (logged) |
| S7 | Stripe 401 (bad key) | returns `null` → "no" (logged) |
| S8 | Stripe network error (fetch rejects) | returns `null` → "no" (logged) |
| S9 | Index miss (cycle not mapped) | returns `null` → "no" |
| S10 | Index malformed (throws at construction) | server won't start (fail-fast) |
| S11 | Request carries correct `Authorization: Bearer sk_test_...` | the fake fetch asserts the header |

All tests use an **injected fake `fetch`** (no network). The fake returns canned `Response` objects (status + JSON body). S11 asserts the outgoing request's `Authorization` header + URL path, proving the source talks to Stripe correctly without touching it.

---

## 10. Done checklist

- [ ] `stripeCashflowSource` factory in `verifiers/src/stripe-cashflow-source.ts`.
- [ ] Payment-index loader (fail-fast on malformed).
- [ ] `serve.ts` `VERIFIER_SOURCE` selector (backward-compatible; default `file`).
- [ ] `.env.example` documents `VERIFIER_SOURCE` + `STRIPE_API_KEY` + `STRIPE_PAYMENT_INDEX_PATH`.
- [ ] Tests S1–S11 green under `pnpm --filter @quittance/verifier test` (existing 30 stay green).
- [ ] Full suite green: `pnpm --recursive test` (151) + dashboard build.
- [ ] README honesty section + ROADMAP updated (SPEC-2 shipped, not "optional").
- [ ] Branch pushed, PR opened, **held for RECTOR's merge approval** (Jul 26 deadline — no main churn without sign-off).
- [ ] **Live e2e (needs RECTOR's Stripe test key)**: create a test PI, run the Stripe-backed verifier, confirm it votes "yes" for a paid PI + "no" for an unpaid one. Deferred until key is provided; unit tests + S11 cover correctness without the key.

---

## 11. What I need from RECTOR

1. **Merge approval** — after the branch is green, I will NOT merge while judges may visit (Jul 26). Your call when.
2. **Stripe test-mode API key** (`sk_test_...`) — only for the **live e2e** (creating a test PI + confirming a real `succeeded` PI). All code + unit tests land without it. Drop it into the per-repo `.env` (`~/Documents/secret/quittance/.env`) as `STRIPE_API_KEY` when ready; I'll wire the live test.

---

*Approve SPEC-2 to unlock implementation. Low-risk, additive, one-package. The campaign stays complete + deployed + merged regardless of whether this bonus ships.*