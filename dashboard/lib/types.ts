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
