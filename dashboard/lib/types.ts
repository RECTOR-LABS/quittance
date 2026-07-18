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
