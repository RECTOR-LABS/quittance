import type { SignedVerdict } from "./types.js";

/**
 * A lightweight reputation snapshot for one verifier, passed to the brief
 * (SPEC-5). Mirrors the on-chain `VerifierScoreSnapshot` (SPEC-6) but lives in
 * core so the seam stays framework-free (no dashboard/contract dep). The agent
 * populates this from the receipt's `reputation_snapshot` when available; for
 * the demo (live receipt read wires at the bundled deploy) it may be empty.
 */
export interface BriefReputationSnapshot {
  signer: string;
  cyclesSeen: number;
  cyclesVoted: number;
  cyclesAgreed: number;
}

/**
 * The inputs to a per-cycle verification brief (SPEC-5). The brief is the
 * agent's LLM-generated, human-readable explanation of a cycle's cryptographically
 * verified record — what the verifiers said, what the chain verified, and why
 * funds moved (or didn't).
 *
 * The brief is **agent-attested narration, NOT cryptographic proof**. The
 * verifiable truth is the on-chain signatures + reputation (SPEC-4/6). The LLM
 * only narrates; it never decides fund release (the quorum stays deterministic).
 */
export interface BriefInput {
  assetId: string;
  cycleId: string;
  /** The signed verdicts collected for the cycle (the LLM interprets these). */
  verdicts: SignedVerdict[];
  /** Whether the cycle settled (true) or halted (false). Settled-only on the
   *  on-chain record path; the agent may narrate a halt off-chain for the demo. */
  distributed: boolean;
  /** The pre-increment reputation snapshot from the receipt (SPEC-6) — lets the
   *  brief reference each verifier's track record. Empty for a halted cycle, or
   *  when the live receipt read isn't wired yet (demo). */
  reputationSnapshot: BriefReputationSnapshot[];
}

/**
 * Produces a per-cycle AI verification brief (SPEC-5). Framework-free seam —
 * the fake (`FakeBriefClient`) is used in unit tests; the real LLM client
 * (Anthropic / Ollama) lives in the agent package.
 *
 * Contract: `brief()` MUST NOT throw for a settled cycle in a way that breaks
 * the cycle — the caller (the servicer agent) treats the brief as best-effort:
 * on failure, no brief is recorded and the cycle outcome is unchanged.
 */
export interface BriefClient {
  brief(input: BriefInput): Promise<string>;
}