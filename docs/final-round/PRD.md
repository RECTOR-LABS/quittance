# Quittance — Final-Round Improvement PRD

> **Campaign PRD** for the Casper Agentic Buildathon 2026 **Final Round** (Jul 13 → Jul 26 23:59, jury eval).
> **Status:** Final draft for RECTOR's sign-off. **No implementation until approved.**
> **Owner:** RECTOR · **Drafted:** 2026-07-18 · **v4** — code-verified competitive landscape + SPEC-6 (verifier reputation) + SPEC-4 reframed as a real edge.
>
> Scope note: the qualifier `SPEC.md` / `PLAN.md` remain the source of truth for the **shipped build**. This PRD governs **only the final-round deltas.** Strategy is now grounded in **competitor source-code verification**, not README claims.

---

## At a glance — before → after

| Dimension | Before (qualifier — shipped) | After (final-round target) | Why it matters |
|---|---|---|---|
| **On-chain verification level** | event-only (L0 — agent attests) | **L3** — contract verifies data-bound Ed25519 verdicts | Strongest in the field (competitors are L1/L2.5 — code-verified) |
| **Verifier reputation** | none | on-chain accuracy/reliability tracking per verifier | **Unique moat** — no competitor has it; Casper's example-#2 |
| **Quorum enforcement** | off-chain (contract trusts servicer key) | ON-CHAIN, atomic single-tx | Closes S3; tagline becomes protocol truth |
| **Agentic AI role** | LLM narrates only | queryable verification brief per cycle | Closes the "Agentic AI" rubric gap |
| **On-chain receipt** | `Distributed` event only | `get_receipt()` + typed `Receipt` (sigs + brief) | Closes S1 |
| **Verifier evidence** | 3/3 mocked fixtures | 2 mocked + 1 real (Stripe test mode) | Closes S2 (optional) |
| **Launch / socials** | deploy + repo only | + project socials, mainnet roadmap, interactive demo | Closes "Long-Term Launch Plans" gap |
| **x402 story** | used, under-sold | front-and-center (67% of prize pool is x402 credits) | Strategic alignment |
| **Quorum threshold** | 2-of-3, idempotent | **UNCHANGED** | Zero change to the rule |
| **`main` branch** | frozen, green | frozen, green | Discipline holds through Jul 26 |
| **Jury posture** | "agent attests; evidence mocked" | **"chain verifies; verifiers have reputation; one real rail; RWA-native"** | 8/8 rubric green |

---

## 1. North Star

**Move verification on-chain, give verifiers a reputation, and make the agent's reasoning part of the record — so "verify, not attest" is true at the protocol level, the Agentic AI is load-bearing, and our on-chain logic is the strongest in the finalist field — within 8 days, without endangering the proven build.**

---

## 2. The vertical depth ladder — where is the quorum *enforced*?

| Level | Quorum enforced… | One-liner | Who's here |
|---|---|---|---|
| **L0** *(shipped qualifier)* | off-chain (agent counts 2-of-3) | "agent attests" | Quittance (today) |
| **L1** | off-chain; chain logs proof | "attests, chain logs" | **AgentPay Guard** (code-verified) |
| **L2.5** | on-chain address-collation (N separate approve txs; counts callers) | "chain counts approvals" | **Concordia** (code-verified) |
| **🔥 L3** *(SPEC-4 target)* | **ON-CHAIN signature verification of data-bound verdicts (atomic)** | **"chain verifies sigs"** | **Quittance (target)** |
| **L4** *(in SPEC-4)* | L3 + verdicts bound to `(asset, cycle, chain_id)` + replay protection | "chain verifies, fresh" | Quittance (target) |
| **L5** *(partial)* | L4 + genuine verifier independence (distinct operators) | "chain verifies, independent" | post-hackathon |

---

## 3. Competitive landscape *(code-verified — read from repo source, not READMEs)*

| Competitor | README claim | Contract reality | Level |
|---|---|---|---|
| **Concordia DAO Council** | "quorum enforced by the chain itself" | Address-collation: 3 signer-addresses each submit a separate approve tx; contract counts distinct callers. **No signature verification.** JSON-string receipts. Own comment: *"intentionally simple and demo-friendly."* | **L2.5** |
| **CSPR AgentPay Guard** | "replay protection, policy controls, receipts" | Contract = proof-anchoring log (`record_proof`/`get_proof`). **All policy/replay/budget logic is off-chain.** | **L1** |
| **Caspergard** | "AI security layer" | **Repo 404 — unverifiable.** | unknown |
| **Quittance (post-SPEC-4)** | "contract verifies the quorum" | On-chain Ed25519 sig verify of data-bound verdicts, atomic single-tx *(target)* | **L3** |

**Strategic read (verified):**
- Competitors' on-chain logic is **demo-simple.** SPEC-4 done right makes ours the **strongest on-chain verification in the field** — a real edge (Technical Execution / Working Smart Contracts / Innovation), *not* parity.
- **SPEC-6 (verifier reputation) is the unique moat** — neither Concordia nor AgentPay tracks verifier accuracy; it maps directly to Casper's example-direction-#2 wording (*"reputation score based on historical accuracy"*).
- **RWA domain is uncontested** — Quittance is the sole project in the track's RWA sweet spot; competitors are DeGov / payment-firewall / security-scanning.

**⚠️ Verification limits (honest):** read from **repo source**, not deployed on-chain wasm (could differ; unlikely). Caspergard unverifiable (repo 404). The field grows over 8 days — this is a snapshot, not the final field. *"Verified from source,"* not *"verified from mainnet"* — one rung up from README attestation, not the top.

---

## 4. Rubric coverage — the 8 jury criteria

| Criterion | Before | After | How |
|---|---|---|---|
| Technical Execution | 🟡 | 🟢 | SPEC-4 (L3, strongest in field) + SPEC-6 |
| Innovation & Originality | 🟢 | 🟢 | verified quorum + reputation for RWA servicing |
| Use of AI / Agentic Systems | 🔴 | 🟢 | SPEC-5 — AI reasoning brief, on the record |
| Real-World Applicability | 🟢 | 🟢 | RWA cashflow servicing (DeFi + RWA) |
| User Experience & Design | 🟡 | 🟢 | receipt aesthetic + interactive "try the fraud" demo |
| Working Smart Contracts | 🟢 | 🟢 | SPEC-4 + deployed, tested vault |
| Long-Term Launch Plans | 🔴 | 🟢 | SPEC-3 — socials + mainnet roadmap + positioning |
| Potential for Long-Term Impact | 🟢 | 🟢 | trust-layer thesis, reputation network vision |

**Before: 5/8 strong, 2 red. After: 8/8 green.**

---

## 5. The soft spots (jury attack surface)

| # | The attack | Closed by |
|---|---|---|
| **S3** *(deepest)* | "The agent counts the quorum off-chain; the contract trusts the servicer key." | **SPEC-4** |
| **S-rep** *(moat)* | "Who are these verifiers, and why trust them?" | **SPEC-6** (reputation) |
| **S-ai** | "The AI just narrates — where's the agentic integration?" | **SPEC-5** |
| **S1** | "Distribution is an event — how do I independently verify a receipt?" | SPEC-1 |
| **S2** | "The verifiers read fake data." | SPEC-2 (optional) |

---

## 6. Context

- Build **SHIPPED, proven on-chain, resubmitted (Under Review)**. Happy 3/3 → distribute; fraud 1/3 → HALT.
- **Jury:** Casper Association leadership + technical experts, partner-org reps, Web3 investors, ecosystem leaders, media. *(Not pure-security — pitch must land for technical AND non-technical judges.)*
- **Prize pool:** $150K = **$30K cash + $100K x402 Ecosystem Credits + $20K in-kind.** x402 is 67% — Quittance uses it natively; major advantage.
- **`main` frozen-discipline** throughout: branch → green → merge small.
- **Window:** ~8 days (Jul 18 → Jul 26 23:59). **Demo Day** end of July.

---

## 7. Goals

- **G1 — On-chain signature verification (SPEC-4).** Contract verifies ≥2 distinct-verifier signed verdicts; servicer key alone can't release funds. Strongest in the field.
- **G2 — Verifier reputation (SPEC-6).** On-chain per-verifier accuracy/reliability — the unique moat.
- **G3 — Agentic reasoning on the record (SPEC-5).** AI produces a queryable verification brief per cycle.
- **G4 — Auditable receipts (SPEC-1).** `get_receipt` returns signed quorum + brief + amounts.
- **G5 — Launch-ready framing (SPEC-3).** Socials + mainnet roadmap + x402 + interactive demo + positioning.
- **G6 — One real rail (SPEC-2, optional).** One verifier reads Stripe test mode.

---

## 8. Non-goals (explicitly fenced out)

- ❌ Verifier **marketplace + staking/slashing economics** *(reputation ≠ marketplace — reputation is transparent accuracy tracking, no economics)*
- ❌ **LLM-driven distribution decisions** — quorum stays deterministic; AI reasons, never decides fund release *(money requires correctness)*
- ❌ Multi-asset / multi-cycle history
- ❌ Full operational verifier independence (distinct operators/companies)
- ❌ Mainnet deployment, real funds
- ❌ Changing the quorum threshold rule (2-of-3 stays)

---

## 9. Scope — the moat stack

### SPEC-4 — On-chain signature verification *(real edge vs demo-simple competitors)*
`distribute()` takes signed verdicts; contract verifies each Ed25519 sig against a registered verifier pubkey, checks `(asset_id, cycle_id)` binding (replay protection), counts valid distinct-verifier yes-votes, distributes only if ≥2-of-3.
- **Day-0 spike:** confirm Odra 2.8 exposes Casper Ed25519 verify. Gates SPEC-4.
- **Reframe (v4):** *not* parity — competitors are L1/L2.5 (code-verified). This is the strongest on-chain verification in the field.
- **Success:** forged sig / replayed verdict / servicer key alone → rejected on-chain.

### SPEC-6 — Verifier reputation/accuracy on-chain *(the unique moat — new in v4)*
Track each verifier's historical accuracy/reliability on-chain: per-cycle resolution scores each verifier (agreement-with-outcome + response reliability; accuracy-vs-truth where ground truth is known). Stored in the verifier registry; surfaced on the dashboard.
- **In:** reputation storage in the registry, per-cycle scoring, dashboard render, tests.
- **Out:** staking/slashing economics, marketplace selection dynamics (post-hackathon).
- **Maps to:** Casper example-#2 — *"verifiable on-chain identity and reputation score based on historical accuracy."*
- **Success:** a judge sees each verifier's on-chain reputation score; the architecture transparently supports trusting higher-reputation verifiers. Bridges the single-operator residual gap (accuracy is transparent even with one operator).

### SPEC-1 — Queryable on-chain receipts *(storage primitive for SPEC-4/5/6)*
`Mapping<(AssetId, CycleId), Receipt>` written on distribute (sigs + brief + reputation snapshot), `get_receipt()` read entrypoint, dashboard render.

### SPEC-5 — Agentic verification brief *(closes the Agentic AI gap; parity with Concordia's agentic story)*
LLM produces a per-cycle verification brief (interprets the 3 verdicts, explains the decision, flags anomalies). Stored alongside the receipt (hash pointer), queryable.
- **In:** LLM call post-quorum, brief storage, dashboard render, prompt + tests.
- **Out:** LLM-driven distribution decisions. *(AI reasons; chain decides.)*

### SPEC-3 — Positioning, launch & the interactive demo *(amplifier — owns RWA, wins the room)*
- **Interactive "try the fraud" demo** — one-click: a judge feeds a fake paid claim and watches the chain refuse. Wrapped in a real RWA scenario (tokenized invoice → investors → payout). *Concordia's "Chain Says No" is a video; ours is hands-on.*
- **Lead message:** "the contract verifies the quorum; verifiers carry on-chain reputation."
- **x402 emphasis** — real settlement evidence front-and-center (67% of prize is x402 credits).
- **Position against example-#2** (RWA Oracle Agents w/ Verifiable On-Chain Identity) — explicit mapping.
- **Launch plans** — project socials, mainnet roadmap doc, "real project" framing.
- README hashes, BUIDL "Manage Submission" update + sample testnet txs.

### SPEC-2 — Real payment-rail adapter *(optional bonus)*
One verifier reads Stripe test mode; others stay mocked; quorum untouched. Ship only if bandwidth remains.

---

## 10. Sequencing

```
SPEC-1 (receipts: storage primitive)
   └─► SPEC-4 (on-chain sig verify — writes sigs into Receipt)
          └─► SPEC-6 (verifier reputation — the moat)
                 └─► SPEC-5 (agentic brief — parity)
                        └─► SPEC-3 (positioning + launch + interactive demo)
                               └─► SPEC-2 (Stripe — optional)
```
**Minimum credible ship (full rubric coverage + moat):** SPEC-1 + SPEC-4 + SPEC-6 + SPEC-3. SPEC-5 if bandwidth; SPEC-2 is the bonus.

---

## 11. Operational tasks (non-SPEC)

- **Triage 3 open Security-tab alerts before Jul 26:** 2 Dependabot (esbuild, postcss moderate) + 1 CodeQL. Clear postcss via `pnpm.overrides`; confirm the CodeQL finding. Requirement is "no High+"; open alerts are a blemish a judge may note.

---

## 12. Campaign success criteria

- ✅ `distribute()` requires ≥2 valid distinct-verifier signed verdicts, verified on-chain; servicer key alone cannot release funds.
- ✅ Each verifier has an on-chain reputation/accuracy score, queryable.
- ✅ Each distributed cycle has a queryable AI verification brief.
- ✅ Forged signature, replayed verdict, sub-quorum calls rejected on-chain (tested).
- ✅ `get_receipt` live, readable from dashboard, carrying sigs + brief + reputation.
- ✅ Interactive "try the fraud" demo live; README + BUIDL reflect the moat.
- ✅ Open Security alerts triaged (no High+).
- ✅ `main` never red; full suite green; quorum threshold logic unchanged.

---

## 13. Known limitations / residual gaps *(honest)*

**Deliberate design choices (defensible):**
- **Determinism > AI autonomy.** LLM reasons (SPEC-5) but never decides distribution.
- **Single-operator verifiers (demo).** All 3 run by RECTOR. SPEC-4 (distinct keys) + SPEC-6 (transparent reputation) make collusion *harder* and *visible*, not operationally impossible.

**Time-bounded (post-hackathon):**
- True verifier independence (distinct operators) + marketplace/staking economics.
- All 3 verifiers on real rails (SPEC-2 ships 1).
- Professional security audit (SPEC-4 is audit-*ready*, not audited).
- Multi-asset / multi-cycle scale.

**Fundamental to a hackathon demo (disclosed):**
- Test asset (WCSPR), no real cashflow/invoice. Testnet only.

**After the campaign:** every rubric criterion green, every soft spot closed, a unique moat (SPEC-6), and the strongest on-chain verification in the field (SPEC-4, code-verified vs competitors). What remains is honest boundary, not oversight.

---

## 14. Constraints (carry into every SPEC)

- **Chain/SDK:** Casper 2.0 `casper-test`, TransactionV1, Odra 2.8.x (`nightly-2026-01-01`), `casper-js-sdk` v5, x402 `PAYMENT-SIGNATURE` header.
- **Signing:** headless EIP-712 / Ed25519 verdict signing already solved (repo gotcha #3) — SPEC-4 *verifies* those on-chain.
- **Testnet only.** Stripe = test-mode keys only. No real funds, ever.
- **Frozen-`main`:** branch → CI green (build + 121 tests + dashboard build + CodeQL) → merge small.
- **Secrets:** per-repo `.env` (symlinked to `~/Documents/secret/quittance/.env`), never hardcoded.
- **No AI attribution.** Honest disclosure maintained/expanded.
- **Low-frequency x402:** handful-of-calls-per-cycle by construction.

---

## 15. Open questions (resolve at SPEC time)

- **Q1 (SPEC-4, day-0) — Sig verify in Odra:** does Odra 2.8 expose Casper's native Ed25519 verify? Spike first — gates SPEC-4. *(Fallback: additive `verify_quorum` read endpoint.)*
- **Q2 (SPEC-4) — Verifier registry governance:** who adds/removes verifiers? Demo: servicer key + emitted events.
- **Q3 (SPEC-4) — Verdict struct:** `(asset_id, cycle_id, verdict, commit)` via EIP-712 over `casper:*` CAIP-2 (reuse solved scheme).
- **Q4 (SPEC-6) — Reputation signal:** agreement-with-outcome + response reliability (always measurable) + accuracy-vs-truth (where ground truth known in demo)? *(Lean: yes — layered signal.)*
- **Q5 (SPEC-6) — Scoring math:** simple ratio vs EWMA decay? *(Lean: simple ratio for demo; EWMA documented as the production design.)*
- **Q6 (SPEC-5) — Brief storage:** on-chain vs IPFS hash pointer? *(Lean: IPFS hash — keeps chain lean.)*
- **Q7 (campaign) — Deploy vs upgrade:** new vault deploy (new hash → BUIDL update) vs Odra package upgrade (same hash)? *(Resolve SPEC-4 day 0 alongside Q1.)*
- **Q8 (SPEC-2) — Stripe resource:** `PaymentIntent` vs `Invoice` vs `Charge`?

---

## 16. What "done" looks like at Jul 26

A judge evaluating Quittance sees the **strongest on-chain verification in the finalist field** (code-verified vs demo-simple competitors), a **unique verifier-reputation moat** no competitor matches, **8/8 rubric criteria green**, an **interactive demo** where they personally watch the chain refuse a fraudulent claim, and a **RWA-native, x402-native, launch-ready** project. "Verify, not attest" is a protocol property backed by signatures *and* reputation — and `main` stayed green the whole time.

**Realistic outcome (honest):** 8/8 rubric green; **#1 confidence ~7–8/10 with clean execution** (up from ~5) — a genuine likely-winner position. Not 9.5+ — irreducible variance (Concordia's agentic branding, judging subjectivity, a growing field) caps any entry. The residual gaps are honest, disclosed, and post-hackathon.

---

*Approve this PRD to unlock SPEC-1 + SPEC-4 (day-0 spike first). Sign-off fixes scope; the SPECs fix design.*
