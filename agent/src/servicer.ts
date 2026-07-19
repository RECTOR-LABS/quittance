import { reachQuorum } from "@quittance/core";
import type { BriefClient, ChainClient, SettlementReceipt, SignedVerdict } from "@quittance/core";
import type { VerifyQuery } from "@quittance/verifier";
import type { VerifierClient, VerifierEndpoint, VerifierResponse } from "./verifier-client.js";

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
  /** Produces the per-cycle AI verification brief (SPEC-5). The LLM only
   *  narrates — it never decides fund release (the quorum stays deterministic). */
  briefClient: BriefClient;
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
  /** The AI verification brief recorded on-chain for a settled cycle (SPEC-5).
   *  Undefined for halted cycles (no settlement to anchor a brief to) or when
   *  the LLM call failed post-settle (best-effort — the cycle still settles). */
  brief?: string;
  receipts: SettlementReceipt[];
  verdicts: SignedVerdict[];
  /** Errors from verifier queries that threw after retries. Empty on full success. */
  errors: { endpointId: string; message: string }[];
}

// Discriminated union so callers get typed access to either the response or the failure info.
type QueryResult =
  | { ok: true; response: VerifierResponse }
  | { ok: false; endpointId: string; message: string };

/**
 * Attempt to query a single verifier endpoint, retrying once on failure.
 *
 * Returns a discriminated union: { ok: true, response } on success, or
 * { ok: false, endpointId, message } if both attempts throw.
 * Never throws out of this function.
 */
async function queryWithRetry(
  client: VerifierClient,
  endpoint: VerifierEndpoint,
  q: VerifyQuery,
): Promise<QueryResult> {
  // First attempt.
  try {
    return { ok: true, response: await client.query(endpoint, q) };
  } catch {
    // Retry once on any thrown error.
  }

  // Second attempt (single retry).
  try {
    return { ok: true, response: await client.query(endpoint, q) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, endpointId: endpoint.id, message };
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
      errors: [],
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
  const errors: { endpointId: string; message: string }[] = [];
  let successCount = 0;

  for (const result of results) {
    if (result.ok) {
      successCount++;
      receipts.push(result.response.receipt);
      verdicts.push(result.response.verdict);
    } else {
      errors.push({ endpointId: result.endpointId, message: result.message });
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
      errors,
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
      errors,
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
      // SPEC-4: forward ALL collected signed verdicts. The contract verifies
      // each Ed25519 signature on-chain and counts only valid distinct
      // registered yes-verdicts. reachQuorum is a pre-check; the chain is the
      // authority (L3).
      signers: verdicts.map((v) => v.signer),
      verdicts: verdicts.map((v) => v.verdict.verdict),
      signatures: verdicts.map((v) => v.signature),
      observed_amounts: verdicts.map((v) => v.verdict.observedAmount),
      sources: verdicts.map((v) => v.verdict.source),
    },
  );

  // ---------------------------------------------------------------------------
  // Step 5b (SPEC-5): produce + record the AI verification brief. Best-effort —
  // the cycle has already settled (funds moved correctly per the cryptographic
  // gate); an LLM or record failure does NOT change the outcome. The brief is
  // agent-attested narration, not proof. Halted cycles never reach here.
  // ---------------------------------------------------------------------------
  let brief: string | undefined;
  try {
    brief = await deps.briefClient.brief({
      assetId: cfg.assetId,
      cycleId,
      verdicts,
      distributed: true,
      // The live receipt read (reputation_snapshot) wires at the bundled deploy;
      // until then the brief narrates from the verdicts + outcome alone.
      reputationSnapshot: [],
    });
    await chainClient.callEntrypoint(cfg.vaultHash, "record_brief", {
      asset_id: cfg.assetId,
      cycle_id: cycleId,
      brief,
    });
  } catch {
    // Best-effort: a failed brief/record leaves the cycle settled; `brief`
    // stays undefined so the caller knows none was recorded.
    brief = undefined;
  }

  return {
    status: "distributed",
    distributeTx: deployResult.txHash,
    brief,
    receipts,
    verdicts,
    errors,
  };
}
