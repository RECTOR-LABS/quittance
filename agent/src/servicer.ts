import { reachQuorum } from "@quittance/core";
import type { ChainClient, SettlementReceipt, SignedVerdict } from "@quittance/core";
import type { VerifyQuery } from "@quittance/verifier";
import type { VerifierClient, VerifierEndpoint } from "./verifier-client.js";

export interface AssetServicingConfig {
  assetId: string;
  vaultHash: string;          // ServicerVault contract hash
  expectedAmount: string;     // integer string, smallest unit
  expectedReference: string;
  quorumRequired: number;     // e.g. 2
  endpoints: VerifierEndpoint[]; // the verifiers to consult (e.g. 3)
}

export interface ServicerDeps {
  verifierClient: VerifierClient;
  chainClient: ChainClient;
}

export type HaltReason =
  | "quorum_not_met"
  | "already_distributed"
  | "payment_failed"
  | "insufficient_responses";

export interface CycleOutcome {
  status: "distributed" | "halted";
  reason?: HaltReason;
  distributeTx?: string;
  receipts: SettlementReceipt[];
  verdicts: SignedVerdict[];
}

/**
 * Attempt to query a single verifier endpoint, retrying once on failure.
 *
 * Returns the VerifierResponse on success, or null if both attempts throw.
 * Never throws out of this function.
 */
async function queryWithRetry(
  client: VerifierClient,
  endpoint: VerifierEndpoint,
  q: VerifyQuery,
): Promise<import("./verifier-client.js").VerifierResponse | null> {
  // First attempt.
  try {
    return await client.query(endpoint, q);
  } catch {
    // Retry once on any thrown error.
  }

  // Second attempt (single retry).
  try {
    return await client.query(endpoint, q);
  } catch {
    return null;
  }
}

/**
 * Autonomous servicing cycle.
 *
 * Step 1 — Already-distributed guard (FIRST): query the on-chain dict before
 *           spending any x402 payment on verifiers.
 * Step 2 — Query each verifier (pay + get verdict), retrying once on failure.
 * Step 3 — Check response count; halt with payment_failed or insufficient_responses.
 * Step 4 — Evaluate quorum; halt with quorum_not_met if not met.
 * Step 5 — Call distribute(); return distributed status.
 */
export async function runCycle(
  deps: ServicerDeps,
  cfg: AssetServicingConfig,
  cycleId: string,
): Promise<CycleOutcome> {
  const { verifierClient, chainClient } = deps;

  // ---------------------------------------------------------------------------
  // Step 1: Already-distributed guard — no payment if already settled on-chain.
  // ---------------------------------------------------------------------------
  const alreadyDistributed = await chainClient.queryDictItem(
    cfg.vaultHash,
    "distributed",
    `${cfg.assetId}:${cycleId}`,
  );

  if (alreadyDistributed) {
    return {
      status: "halted",
      reason: "already_distributed",
      receipts: [],
      verdicts: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Step 2: Query each verifier (in parallel — ordering is non-deterministic
  // but that is fine; quorum logic is set-based not order-sensitive).
  // ---------------------------------------------------------------------------
  const query: VerifyQuery = {
    assetId: cfg.assetId,
    cycleId,
    expectedAmount: cfg.expectedAmount,
    expectedReference: cfg.expectedReference,
  };

  const results = await Promise.all(
    cfg.endpoints.map((ep) => queryWithRetry(verifierClient, ep, query)),
  );

  const receipts: SettlementReceipt[] = [];
  const verdicts: SignedVerdict[] = [];
  let successCount = 0;

  for (const result of results) {
    if (result !== null) {
      successCount++;
      receipts.push(result.receipt);
      verdicts.push(result.verdict);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 3: Insufficient responses check.
  // Reason precedence: all failed → payment_failed; some-but-too-few → insufficient_responses.
  // ---------------------------------------------------------------------------
  if (successCount < cfg.quorumRequired) {
    const allFailed = successCount === 0;
    return {
      status: "halted",
      reason: allFailed ? "payment_failed" : "insufficient_responses",
      receipts,
      verdicts,
    };
  }

  // ---------------------------------------------------------------------------
  // Step 4: Quorum evaluation.
  // ---------------------------------------------------------------------------
  const quorum = reachQuorum(verdicts, cfg.quorumRequired);

  if (!quorum.passed) {
    return {
      status: "halted",
      reason: "quorum_not_met",
      receipts,
      verdicts,
    };
  }

  // ---------------------------------------------------------------------------
  // Step 5: Quorum passed — call distribute().
  // ---------------------------------------------------------------------------
  const deployResult = await chainClient.callEntrypoint(
    cfg.vaultHash,
    "distribute",
    {
      asset_id: cfg.assetId,
      cycle_id: cycleId,
      verdict_hashes: quorum.verdictHashes,
      signers: quorum.yesSigners,
    },
  );

  return {
    status: "distributed",
    distributeTx: deployResult.txHash,
    receipts,
    verdicts,
  };
}
