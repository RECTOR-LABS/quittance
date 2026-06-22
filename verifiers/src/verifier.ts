import { signVerdict } from "@quittance/core";
import type { SignedVerdict, Verdict } from "@quittance/core";
import { decide } from "./verdict.js";
import type { CashflowSource } from "./verdict.js";

export interface VerifierConfig {
  source: CashflowSource;
  signingKeyHex: string;
  label: string; // becomes Verdict.source (this verifier's identity)
}

export interface VerifyQuery {
  assetId: string;
  cycleId: string;
  expectedAmount: string;
  expectedReference: string;
}

/**
 * Fetch evidence from the configured source, decide the verdict, build and
 * sign the Verdict, and return the SignedVerdict.
 *
 * This is pure logic + signing — no HTTP, no x402 gating (deferred to a
 * later creds-gated task).
 */
export async function runVerifier(
  cfg: VerifierConfig,
  q: VerifyQuery,
): Promise<SignedVerdict> {
  const evidence = await cfg.source.fetch(q.assetId, q.cycleId);
  const result = decide(evidence, q.expectedReference);

  const verdict: Verdict = {
    assetId: q.assetId,
    cycleId: q.cycleId,
    verdict: result,
    observedAmount: evidence?.observedAmount ?? "0",
    source: cfg.label,
  };

  return signVerdict(verdict, cfg.signingKeyHex);
}
