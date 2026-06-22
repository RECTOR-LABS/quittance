import { canonicalHash, verifyVerdict } from "./sign.js";
import type { Hash, PublicKeyHex, SignedVerdict } from "./types.js";

export interface QuorumResult {
  passed: boolean;
  yesSigners: PublicKeyHex[];
  verdictHashes: Hash[]; // hashes of the "yes" verdicts that count toward quorum
}

/**
 * Evaluates a set of signed verdicts against a required threshold.
 *
 * Algorithm:
 *  1. Drop any verdict whose signature does not verify (invalid signature).
 *  2. Deduplicate by signer: if a signer appears multiple times, only the
 *     first valid "yes" from that signer is counted (subsequent votes ignored).
 *  3. Count unique valid "yes" voters.
 *  4. passed = (unique valid "yes" voters) >= required.
 *
 * `yesSigners` and `verdictHashes` contain only the deduplicated "yes" entries
 * that were actually counted toward the quorum — these are passed on to the
 * on-chain distribute() entrypoint as the quorum proof.
 *
 * @param verdicts - Array of signed verdicts from the verifier services.
 * @param required - Minimum number of unique "yes" signers to pass quorum.
 */
export function reachQuorum(
  verdicts: SignedVerdict[],
  required: number
): QuorumResult {
  const yesSigners: PublicKeyHex[] = [];
  const verdictHashes: Hash[] = [];
  const seenSigners = new Set<PublicKeyHex>();

  for (const sv of verdicts) {
    // 1. Drop invalid signatures.
    if (!verifyVerdict(sv)) {
      continue;
    }

    // 2. Deduplicate by signer — each signer counts at most once.
    if (seenSigners.has(sv.signer)) {
      continue;
    }
    seenSigners.add(sv.signer);

    // 3. Only "yes" verdicts advance the quorum count.
    if (sv.verdict.verdict === "yes") {
      yesSigners.push(sv.signer);
      verdictHashes.push(canonicalHash(sv.verdict));
    }
  }

  return {
    passed: yesSigners.length >= required,
    yesSigners,
    verdictHashes,
  };
}
