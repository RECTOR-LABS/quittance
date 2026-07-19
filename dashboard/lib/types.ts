export interface Holder {
  label: string;
  publicKeyHex: string;
  accountHash: string;
  weightPct: number;
}

export interface Verifier {
  label: string;
  publicKeyHex: string;
  payTo: string;
}

export interface AssetConfig {
  assetId: string;
  reference: string;
  expectedCashflowMotes: string;
  narrative: string;
  vault: { entityHash: string; packageHash: string; installTx: string };
  quorumRequired: number;
  pool: { fundedMotes: string; fundTx: string | null };
  registerTx: string | null;
  holders: Holder[];
  verifiers: Verifier[];
}

export interface Verdict {
  source: string;
  verdict: 'yes' | 'no';
  observedAmount: string;
  signer: string;
  signature: string;
}

export interface Receipt {
  verifierId: string;
  deployHash: string;
  linkable: boolean;
}

/**
 * A pre-increment reputation snapshot for one verifier, stored in the
 * on-chain `Receipt` (SPEC-6) — the track record each verifier *brought to*
 * a settlement. Display identifier is the verifier label (committed) or
 * pubkey hex (live).
 */
export interface VerifierScoreSnapshot {
  signer: string;
  cyclesSeen: number;
  cyclesVoted: number;
  cyclesAgreed: number;
}

/**
 * On-chain reputation for one verifier (SPEC-6) — the unique moat. Accumulated
 * inside `distribute()` on every successful settlement; read via the contract's
 * `get_verifier_registry`. Informational only — never gates fund release.
 */
export interface VerifierReputation {
  /** Display label (committed) or pubkey hex (live). */
  signer: string;
  pubkeyHex: string;
  /** Times this verifier was registered for an asset whose cycle settled. */
  cyclesSeen: number;
  /** Times this verifier submitted a valid signed verdict on a settling cycle. */
  cyclesVoted: number;
  /** Times this verifier voted `yes` on a settling cycle (agreed with outcome). */
  cyclesAgreed: number;
  /** Most recent verdict on a settling cycle (`yes` | `no` | null until first vote). */
  lastVerdict?: 'yes' | 'no' | null;
  /** Most recent cycle id this verifier was scored on. */
  lastCycle?: string | null;
}

/**
 * The on-chain distribution receipt (SPEC-1) — the queryable mirror of the
 * contract's `Distributed` event, stored per `(assetId, cycleId)` and readable
 * via the contract's `get_receipt`. Distinct from the per-verifier x402
 * payment `Receipt` above.
 */
export interface DistributionReceipt {
  assetId: string;
  cycleId: string;
  /** Block time at settlement (ms since epoch) — populated by the live read; undefined when derived from committed data. */
  settledAt?: number;
  totalDistributedMotes: string;
  dustRetainedMotes: string;
  holderCount: number;
  quorumRequired: number;
  /** Distinct registered verifiers (labels) whose yes-verdicts satisfied the gate. */
  signers: string[];
  /** Verdict provenance digests (signatures observed for the cycle). */
  verdictHashes: string[];
  /** Pre-increment reputation per registered verifier (SPEC-6) — the track record brought to this settlement. */
  reputationSnapshot: VerifierScoreSnapshot[];
  /** Deep-link to the on-chain settlement (cspr.live deploy). */
  verifyTx?: string;
}

export interface Payout {
  holderLabel: string;
  motes: string;
}

export interface Cycle {
  cycleId: 'happy' | 'fraud';
  status: 'distributed' | 'halted';
  reason?: string;
  verdicts: Verdict[];
  receipts: Receipt[];
  quorum: { yesCount: number; required: number; met: boolean };
  distributeTx?: string;
  payouts?: Payout[];
}
