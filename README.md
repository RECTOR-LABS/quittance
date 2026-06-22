# Quittance

**Autonomous, verification-gated servicing for tokenized real-world cashflows on Casper.**

Quittance is an autonomous agent and on-chain vault that releases a tokenized real-world cashflow to its holders **only after independently verifying the money actually arrived** — verification, not attestation.

Built for the [Casper Agentic Buildathon 2026](https://dorahacks.io/hackathon/casper-agentic-buildathon) · Casper Innovation Track · Casper Testnet.

## The problem

Tokenized real-world assets — invoices, rent, royalties, private credit — are a growing on-chain market, but *servicing* them (confirming the off-chain cashflow genuinely arrived, then distributing it to token holders) is still manual and trust-based. On-chain today, projects push data *in* via oracles; nobody autonomously pushes verified cashflow *out*. Holders are left trusting an issuer's word.

## The insight

Recording that a payout happened is not proof it was *owed*. Quittance shifts from **attestation** (a single source's say-so) to **verification** (an independent 2-of-3 quorum) before any funds move.

## How it works

Each cycle, the servicer agent:

1. Detects a cycle is due for a tokenized asset.
2. Pays **three independent verifiers** over x402 to answer "did the cashflow arrive?"
3. Requires a **2-of-3 quorum**.
4. If met, executes the on-chain distribution to holders pro-rata and writes a verifiable receipt.
5. If not, halts, pays nothing, and flags a dispute.

The demonstrable moment: feed a fake "paid" claim and watch the agent **refuse to release funds**.

## Architecture

| Component | Responsibility |
| --- | --- |
| `ServicerVault` (Odra) | Holds the distribution pool + holder registry, records per-cycle receipts, exposes quorum-gated `distribute()`. |
| Servicer agent (TS) | Runs the cycle; pays verifiers and calls the contract through stable adapter seams. |
| Verifier services ×3 (TS) | Independent, x402-gated endpoints returning signed yes/no verdicts. |
| Dashboard (Next.js) | Issuer configuration + holder view with receipts and on-chain tx links. |

An architecture diagram will live in `assets/` once the build begins.

## Status

Planning complete; qualifier build targets the July 1 deadline.

- [`SPEC.md`](./SPEC.md) — design
- [`PLAN.md`](./PLAN.md) — implementation plan (qualifier)
- [`DAY1-DERISK.md`](./DAY1-DERISK.md) — critical-path de-risk runbook

## Reference vertical

Invoice financing is the demo anchor (most legible, cleanest independent verification). Quittance is asset-agnostic by design — private credit, rent, and royalty streams are the documented expansion path.

## Honesty & disclosure

For the buildathon demo, the off-chain "cashflow arrived" evidence is **mocked/sandboxed** — the three verifiers stand in for real payment-rail adapters (bank APIs, Stripe). The innovation is the verification-gated autonomous release, not the data source. Testnet only; the payout token is a test CEP-18, not a real stablecoin.

## License

MIT — see [LICENSE](./LICENSE).
