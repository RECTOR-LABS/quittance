export type PublicKeyHex = string;
export type Hash = string; // 32-byte hex, the canonical hash of a Verdict

export interface Verdict {
  assetId: string;
  cycleId: string;
  verdict: "yes" | "no";
  observedAmount: string; // integer string (motes/smallest unit)
  source: string;         // verifier identity / data source label
}

export interface SignedVerdict {
  verdict: Verdict;
  signature: string;      // hex
  signer: PublicKeyHex;
}
