/**
 * A raw 32-byte Ed25519 public key as lowercase hex (64 chars), **without** any
 * Casper key-type tag — the form produced by `@noble/ed25519`. An adapter that
 * builds a `casper-js-sdk` `PublicKey` from this MUST prepend the Casper Ed25519
 * algorithm tag (`0x01`) so the resulting CLValue serialization is byte-identical
 * to the `PublicKey` the contract stored at `register_asset`; otherwise the
 * on-chain membership check `verifiers.contains(signer)` fails and `distribute`
 * reverts `QuorumNotMet`.
 */
export type PublicKeyHex = string;

/**
 * The canonical hash of a `Verdict`: a 32-byte digest as hex (64 chars). An
 * adapter passing this to the on-chain `distribute` MUST decode it to raw
 * `[u8; 32]` bytes for the contract's `verdict_hashes: Vec<[u8; 32]>` — it is
 * not sent on-chain as a hex string.
 */
export type Hash = string;

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
