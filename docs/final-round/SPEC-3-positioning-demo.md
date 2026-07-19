# SPEC-3 — Positioning, Launch & the Interactive "Try the Fraud" Demo (the win-the-room amplifier)

> **Workstream 5 of the Final-Round campaign** (see `PRD.md` §9). Closes the last red rubric gap — "Long-Term Launch Plans" — and is the win-the-room amplifier: owns the RWA lane, fronts x402 (67% of the prize pool), and gives a judge a hands-on "watch the chain refuse" moment. *Concordia's "Chain Says No" is a video; ours is interactive.*
> **Status:** Draft for RECTOR's sign-off. **No implementation until approved.**
> **Depends on:** SPEC-1/4/5/6 (the interactive demo surfaces their on-chain properties: verified signatures, reputation, the AI brief, the absent receipt on halt). **Deploy-dependent tail:** README contract hashes + BUIDL sample txs wait for the bundled deploy (unit #8).
> **Day-0 spike: none needed** — uses only existing dashboard stack (Next.js, Tailwind, lucide-react, the committed-ledger data + helpers).

---

## 1. Goal

Make a judge **feel** the thesis in 60 seconds: feed a fake "paid" claim, watch the chain refuse, and understand *why* — "the contract verifies the quorum; verifiers carry on-chain reputation; the AI explains it." Then hand them a credible launch path (mainnet roadmap) so "real project, not a hackathon toy" lands. This is the amplifier that moves a 7→8 to a likely-winner.

**North-Star link (PRD G5):** close soft spot **S-launch** ("where's the launch plan? is this real?") and turn the rubric's "Long-Term Launch Plans" 🔴 → 🟢. The interactive demo also re-proves SPEC-4/5/6 to a non-technical judge without making them read contract code.

---

## 2. Scope

**In (buildable now, no deploy needed):**
- An **interactive "try the fraud" demo** — a guided, client-side walkthrough on `/demo` (the existing route, upgraded): the RWA scenario → "submit a fake paid claim" (one compromised verifier says yes) → step-by-step the chain's refusal (quorum fails → halt → no receipt, no payout, reputation unchanged, no brief) → the contrast with the happy cycle (3 yes → distribute → receipt + payout + reputation + brief). Uses the real committed verdict data + the real contract properties surfaced honestly.
- **Positioning copy** — README rewrite (post-SPEC-4/5/6) + dashboard hero/landing lead message: *"the contract verifies the quorum; verifiers carry on-chain reputation; the AI explains — the chain decides."* Explicit **x402 emphasis** (real settlement evidence front-and-center; 67% of the prize is x402 credits). Explicit **example-#2 mapping** (RWA Oracle Agents w/ Verifiable On-Chain Identity — Quittance is that, built).
- **`ROADMAP.md`** — the Long-Term Launch Plans artifact: testnet → real payment-rail adapter (Stripe/bank) → multi-asset multi-cycle → verifier marketplace w/ staking/slashing → mainnet. Plus a "real project" framing section (the trust-layer thesis, the reputation-network vision).
- **Project socials** — a placeholder/section for the project's X/Twitter + a "follow the build" CTA (RECTOR to create the account; the SPEC wires the link).

**Out (deferred / deploy-dependent):**
- **README contract hashes + BUIDL sample txs** — gated on the bundled deploy (new contract hash + fresh sample testnet txs). Documented as the SPEC-3 tail; lands when the deploy lands.
- **Live on-chain demo trigger** — the interactive demo is a **client-side guided walkthrough** (see §3), not a live testnet call. A post-deploy enhancement could read the live fraud-cycle state (the "nothing" — halted, no receipt) to prove the refusal on-chain; out of scope for the v1 demo.
- **A real RWA / real cashflow** — the demo stays the tokenized-invoice **scenario** (disclosed); a real rail is SPEC-2 (optional bonus).
- **Mainnet deployment** — roadmap only; no real funds, ever.

---

## 3. Key design decision — the interactive demo is a guided client-side walkthrough, not a live on-chain trigger

A judge cannot be asked to fund a wallet, run the e2e harness, and wait for finality to "try the fraud." And triggering a real fraud cycle needs the deployed contract + the agent + a funded key. So the interactive demo is a **guided, client-side, step-by-step walkthrough** of the real logic over the real committed verdict data:

| Step | What the judge sees | What it proves |
|---|---|---|
| 1. The scenario | A tokenized invoice → 2 investors → a servicing cycle due | The RWA framing (uncontested lane) |
| 2. "Submit a fake paid claim" (button) | One verifier flips to a compromised "yes" (the bribe) | The attack |
| 3. The chain's response | Quorum 1/3 → **HALT** → no receipt written, no payout, reputation unchanged, no brief | SPEC-4 (the gate is on-chain) + SPEC-1 (no phantom receipt) + SPEC-6 (halted cycles don't score) + SPEC-5 (no brief on halt) |
| 4. The contrast | The happy cycle (3 yes) → distribute → receipt + payout + reputation + brief | The full verified record |
| 5. The "why" | "the contract verifies each signature on-chain; verifiers carry reputation; the AI explains — the chain decides" | The thesis, in plain language |

**Why this is honest, not a fake:** it walks through the **real** contract logic (the quorum gate, the no-receipt-on-halt, the no-score-on-halt) over the **real** committed verdict data (the fraud cycle that actually ran on testnet). It is not simulating a different system — it's visualizing the one that's deployed and tested. The "interactive" value is the judge *driving* the attack and watching the refusal play out, not a live RPC call. Disclosed on-page: *"a guided walkthrough of the real on-chain logic over the testnet-proven cycle."*

The alternative — a live on-chain trigger — is a post-deploy enhancement (read the live fraud-cycle state, which is "nothing," to prove the refusal persisted on-chain). Flagged in §2 as out of scope for v1.

---

## 4. The interactive demo (dashboard)

A new `TryTheFraudDemo` client component on `/demo` (the existing route, upgraded — the video stays; the interactive walkthrough is added above it). Self-contained, no new deps, Tailwind, lucide icons, Space Mono aesthetic.

### 4.1 Component shape
- **State machine** (client `useState`): `idle → scenario → attack → refusal → contrast → why`.
- **The attack button** ("Submit a fake 'paid' claim") flips the fraud cycle's compromised verifier to "yes" and advances the state.
- **The refusal panel** renders the fraud cycle's verdicts + the quorum gate (1/3 → NOT MET) + the four properties (no receipt, no payout, reputation unchanged, no brief) with lucide icons (`ShieldX`, `Ban`, `Award`, `Sparkles`).
- **The contrast panel** renders the happy cycle side-by-side (3 yes → MET → receipt + payout + reputation + brief).
- **The "why" panel** is the thesis in plain language + a link to the source/contract.

### 4.2 Data source
The committed `cycles.json` (the happy + fraud cycles that actually ran on testnet) + the existing helpers (`distributionReceiptForCycle`, `verifierRegistryFromCommitted`, `briefForCycle`). No live RPC. The fraud cycle's "no receipt / no reputation update / no brief" is derived from the same honest model the contract enforces (halted cycles score nothing).

### 4.3 Honest copy (on-page)
*"A guided walkthrough of the real on-chain logic over the testnet-proven cycle. The contract verifies each Ed25519 signature on-chain (SPEC-4); verifiers carry on-chain reputation (SPEC-6); the AI explains — the chain decides (SPEC-5). This is the logic that's deployed and tested, not a simulation of a different system."*

---

## 5. Positioning copy (README + landing)

### 5.1 README rewrite (post-SPEC-4/5/6)
The current README is pre-SPEC-4 (says "agent attests the quorum"; "event as the receipt"). Update to the post-campaign reality:
- **Lead message:** *"the contract verifies the quorum on-chain; verifiers carry on-chain reputation; the AI explains — the chain decides."*
- **The depth ladder** (PRD §2): L0 (qualifier) → L3 (SPEC-4, strongest in the field, code-verified vs demo-simple competitors) — a compact table.
- **The moat stack** (SPEC-1/4/6/5): one line each, with the honest limitations.
- **x402 emphasis:** a dedicated subsection — "x402 is 67% of the prize pool; Quittance uses it natively for every verifier payment, settled on Casper" — with the real settlement txs (deploy-dependent tail).
- **Example-#2 mapping:** a subsection — "Casper's example-direction-#2: RWA Oracle Agents with Verifiable On-Chain Identity and a reputation score based on historical accuracy. Quittance is that, built: verifiable on-chain identity (registry from registration) + reputation score (SPEC-6) for RWA cashflow servicing."
- **Honesty & disclosure** — expanded: the off-chain evidence is mocked/sandboxed; the reputation tracks settled cycles only (halted cycles don't score — the honest limitation); the brief is narration, not proof.

### 5.2 Landing/issuer hero (dashboard `app/page.tsx`)
The current hero says "Funds reach holders only after an independent quorum confirms the cashflow arrived." Upgrade the sub-line to the post-campaign lead: *"the contract verifies the quorum on-chain · verifiers carry reputation · the AI explains · the chain decides."* Add an x402 badge/line in the AssetHeader area.

---

## 6. `ROADMAP.md` (Long-Term Launch Plans)

A new top-level `ROADMAP.md` — the artifact a judge reads for "is this real?":

- **Now (final-round):** testnet, 3 single-operator verifiers, mocked off-chain evidence, on-chain verification (SPEC-4) + reputation (SPEC-6) + agentic brief (SPEC-5).
- **Next (post-hackathon, ~Q1):** one real payment-rail adapter (Stripe test → prod), multi-asset multi-cycle dashboard history, queryable on-chain receipts in production.
- **Then (~Q2):** verifier marketplace with staking/slashing (reputation becomes economic), genuine verifier independence (distinct operators/companies), a real RWA pilot (tokenized invoice with a partner).
- **Mainnet (~Q3):** Casper mainnet deployment, audited contract, real cashflows, real funds — the trust-layer thesis in production.
- **The vision:** a reputation network for RWA servicing — verifiers compete on accuracy; issuers get trustless payout; holders get verifiable receipts. "Verify, not attest" as a primitive.

Plus a **"real project" framing** section: the problem (RWA servicing is manual/trust-based), the insight (verify before funds move), the team, the live demo, the source. And a **project socials** line (X/Twitter — RECTOR to create; the SPEC wires the link placeholder).

---

## 7. Deploy-dependent tail (after unit #8)

These land when the bundled testnet deploy lands (RECTOR's gate):
- **README contract hashes** — update `contract-6a6747d2…b27e132` → the new hash; add the SPEC-4/5/6 sample txs (a forged-sig-rejected tx, a reputation-accumulating double-settle, a brief-recorded tx).
- **BUIDL "Manage Submission"** — update the contract address + add the sample testnet txs to the BUIDL page.
- **Live-demo pointer** — the interactive demo's "see it on-chain" link → the real fraud-cycle settle (which is "nothing" — the halt) + the happy-cycle distribute tx.

---

## 8. Tests

The interactive demo is a client component with state — test the state machine + the honest-copy assertions:
| # | Case | Asserts |
|---|---|---|
| T1 | idle → scenario → attack → refusal → contrast → why transitions | each state renders its panel |
| T2 | the attack button advances idle/scenario → refusal | the compromised "yes" + quorum NOT MET shown |
| T3 | the refusal panel shows all four properties (no receipt, no payout, reputation unchanged, no brief) | SPEC-1/4/5/6 surfaced |
| T4 | the contrast panel shows the happy cycle's receipt + payout + reputation + brief | the full verified record |
| T5 | the honest copy is present ("guided walkthrough… not a simulation of a different system") | disclosure on-page |

README/ROADMAP are docs (no unit tests; a `pnpm --filter @quittance/dashboard build` confirms no broken links/copy in the rendered pages).

---

## 9. Done checklist

- [ ] `TryTheFraudDemo` client component on `/demo` (state machine, attack button, refusal + contrast + why panels, honest copy).
- [ ] Tests T1–T5 green (`dashboard`).
- [ ] README rewritten (post-SPEC-4/5/6: lead message, depth ladder, moat stack, x402 emphasis, example-#2 mapping, expanded honesty).
- [ ] Landing/issuer hero sub-line upgraded; x402 surfaced.
- [ ] `ROADMAP.md` (now → next → then → mainnet → vision + real-project framing + socials placeholder).
- [ ] Full workspace + dashboard build green.
- [ ] (Deploy-dependent tail, after unit #8) README hashes + BUIDL sample txs + live-demo pointer.

---

*Approve SPEC-3 to unlock PLAN-3 → implementation on `feat/spec-1-receipts`. After SPEC-3 (code/copy): the bundled testnet deploy (units #8 + the SPEC-3 tail), then merge to `main`. This is the amplifier — the moment a judge personally watches the chain refuse a bribe, and a credible path to mainnet.*