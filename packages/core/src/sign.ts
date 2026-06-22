import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import type { Hash, SignedVerdict, Verdict } from "./types.js";

// @noble/ed25519 v2 requires sha512 to be wired in for synchronous methods.
// We configure it once at module-load time so all callers get sync sign/verify.
ed.etc.sha512Sync = (...messages: Uint8Array[]) =>
  sha512(ed.etc.concatBytes(...messages));

/**
 * Fixed canonical key order for Verdict JSON serialisation.
 * Stable across runtimes regardless of object construction order.
 */
const VERDICT_KEY_ORDER: ReadonlyArray<keyof Verdict> = [
  "assetId",
  "cycleId",
  "verdict",
  "observedAmount",
  "source",
] as const;

/**
 * Produces a deterministic 32-byte SHA-256 hash over the canonical JSON of
 * a Verdict, returned as a lowercase hex string. This is the value that
 * signers sign and that the on-chain distribute() entrypoint stores.
 */
export function canonicalHash(v: Verdict): Hash {
  const canonical: Record<string, string> = {};
  for (const key of VERDICT_KEY_ORDER) {
    canonical[key] = v[key];
  }
  const json = JSON.stringify(canonical);
  const digest = sha256(new TextEncoder().encode(json));
  return bytesToHex(digest);
}

/**
 * Signs the canonical hash of a Verdict with the given Ed25519 secret key.
 *
 * @param v           - The verdict to sign.
 * @param secretKeyHex - 32-byte secret key, lowercase hex.
 * @returns SignedVerdict containing the verdict, hex signature, and hex public key.
 */
export function signVerdict(v: Verdict, secretKeyHex: string): SignedVerdict {
  const secretKeyBytes = hexToBytes(secretKeyHex);
  const hashHex = canonicalHash(v);
  const hashBytes = hexToBytes(hashHex);

  const signatureBytes = ed.sign(hashBytes, secretKeyBytes);
  const publicKeyBytes = ed.getPublicKey(secretKeyBytes);

  return {
    verdict: v,
    signature: bytesToHex(signatureBytes),
    signer: bytesToHex(publicKeyBytes),
  };
}

/**
 * Verifies that the signature in a SignedVerdict is a valid Ed25519 signature
 * over the canonical hash of its embedded Verdict, under the stated signer key.
 *
 * Returns false (not throws) for any invalid input — malformed hex, wrong key,
 * or tampered verdict fields.
 */
export function verifyVerdict(s: SignedVerdict): boolean {
  try {
    const hashHex = canonicalHash(s.verdict);
    const hashBytes = hexToBytes(hashHex);
    const signatureBytes = hexToBytes(s.signature);
    const publicKeyBytes = hexToBytes(s.signer);

    return ed.verify(signatureBytes, hashBytes, publicKeyBytes);
  } catch {
    // Malformed hex, wrong-length bytes, or library rejection — treat as invalid.
    return false;
  }
}
