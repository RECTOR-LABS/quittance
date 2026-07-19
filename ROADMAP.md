# Quittance — Roadmap

> **The path from a testnet buildathon demo to a mainnet trust layer for RWA servicing.**
> The final-round campaign (SPEC-1/4/5/6) is built and tested on `feat/spec-1-receipts`; this roadmap is the honest path from here to production. See [`README.md`](./README.md) for what's built today.

---

## Now — final-round campaign (built, tested, pending testnet deploy)

- **On-chain signature verification (SPEC-4, L3)** — `distribute()` verifies each Ed25519 verdict signature on-chain; forged/replayed/unregistered sigs rejected by the chain. Strongest on-chain verification in the finalist field.
- **On-chain verifier reputation (SPEC-6, the moat)** — per-verifier `cycles_seen`/`voted`/`agreed`, queryable via `get_verifier_registry`. Maps to Casper example-direction-#2.
- **Queryable on-chain receipts (SPEC-1)** — `get_receipt` per `(asset, cycle)`.
- **Agentic verification brief (SPEC-5)** — the AI explains the verified record on-chain; it reasons, the chain decides.
- **Interactive "try the fraud" demo + positioning (SPEC-3)** — a judge drives the attack and watches the chain refuse.
- **Real payment-rail adapter (SPEC-2, optional bonus)** — one verifier can read **Stripe test mode** instead of a fixture (`VERIFIER_SOURCE=stripe`). Unit-tested with an injectable `fetch`; the default demo keeps mocked fixtures for reproducibility; the live e2e against Stripe test mode runs with a test-mode key. Closes the "mocked evidence" disclosure for one of three verifiers.
- **Testnet only.** 3 single-operator verifiers; mocked off-chain evidence by default (SPEC-2 upgrades one); WCSPR/test-CSPR.

**Pending (RECTOR's gate):** the bundled testnet deploy (new contract hash + e2e smoke incl. cross-side TS-sign→Rust-verify byte-consistency + the SPEC-3 tail: README hashes + BUIDL sample txs), then merge to `main`. SPEC-2 is additive to the verifier service only — no contract change, no redeploy.

---

## Next — post-hackathon (~Q1 2026)

- **All three verifiers on real rails** — SPEC-2 ships one (Stripe test mode); the remaining two still read fixtures. A bank API + a second processor close the rail set so no single verifier is mocked. The quorum stays untouched.
- **Multi-asset, multi-cycle dashboard history** — the dashboard shows a portfolio of tokenized cashflows with full cycle history (today: one asset, two showcase cycles).
- **Queryable receipts in production** — `get_receipt` + `get_verifier_registry` + `get_brief` surfaced as a first-class read API (indexer-friendly), not just dashboard reads.
- **Audited contract** — SPEC-4 is audit-*ready*, not audited. Engage a Casper-familiar firm; remediate; publish the report.

---

## Then — the marketplace (~Q2 2026)

- **Verifier marketplace with staking/slashing** — reputation becomes *economic*: verifiers stake CSPR to register; inaccurate verdicts get slashed; accurate verifiers earn. The reputation score (SPEC-6) becomes the selection signal. *(Currently a documented non-goal; this is where it earns its keep.)*
- **Genuine verifier independence** — distinct operators/companies run verifiers; SPEC-4 (distinct keys) + SPEC-6 (transparent reputation) + staking make collusion economically irrational, not just visible.
- **A real RWA pilot** — a tokenized invoice with a partner (a fintech, a factoring desk). Real cashflow, real holders, real servicing — the thesis in production with real money on testnet first.

---

## Mainnet (~Q3 2026)

- **Casper mainnet deployment** — audited contract; real CSPR; real cashflows; real funds.
- **The trust-layer thesis in production** — "verify, not attest" as a primitive: issuers get trustless payout, holders get verifiable receipts, verifiers compete on accuracy.

---

## The vision — a reputation network for RWA servicing

A network where **verifiers compete on accuracy**, **issuers get trustless payout**, and **holders get verifiable receipts** — for any tokenized real-world cashflow (invoices, rent, royalties, private credit). Quittance is the primitive: an autonomous, verification-gated servicing layer that releases cashflows *only after independent verifiers confirm the money arrived*, with every verifier's track record on-chain and every cycle explained by an AI that reasons while the chain decides.

**Verify, not attest.** From a buildathon demo to the trust layer for the on-chain RWA market.

---

## Project

- **Live demo:** [quittance.rectorspace.com](https://quittance.rectorspace.com) · **interactive:** [/demo](https://quittance.rectorspace.com/demo)
- **Source:** [github.com/RECTOR-LABS/quittance](https://github.com/RECTOR-LABS/quittance)
- **Built for:** the Casper Agentic Buildathon 2026, Casper Innovation Track.
- **Project socials:** TBD (X/Twitter project account — to be created).
- **License:** MIT.

---

*This roadmap is honest about what's built (testnet demo), what's next (a real rail, an audit, a marketplace), and what's the vision (a mainnet trust layer). No fake mainnet, no real funds yet, no unverifiable claims.*