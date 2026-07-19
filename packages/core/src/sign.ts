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
 * Compile-time exhaustiveness guard: asserts that T is exactly never, meaning
 * every member of the union has been handled. If Verdict gains a field and
 * VERDICT_KEY_ORDER is not updated, the `Exclude` below will be non-never and
 * tsc will emit an error pointing here.
 *
 * Usage: type _Check = ExhaustiveKeyList<Verdict, typeof VERDICT_KEY_ORDER[number]>
 */
type ExhaustiveKeyList<TObj, TListed extends keyof TObj> =
  [Exclude<keyof TObj, TListed>] extends [never]
    ? true
    : ["Missing keys in VERDICT_KEY_ORDER: ", Exclude<keyof TObj, TListed>];

/**
 * Fixed canonical field order for Verdict encoding. Stable across runtimes
 * regardless of object construction order. Used by BOTH `canonicalBytes` (the
 * value that is signed — SPEC-4) and `canonicalHash` (its digest).
 *
 * IMPORTANT: this list MUST contain every key in `Verdict`. The compile-time
 * guard below (`_VerdictKeyOrderExhaustive`) turns any missing key into a tsc
 * error, preventing silent omission from the signed bytes. The on-chain Odra
 * contract reconstructs the identical byte sequence (SPEC-4 §4) — order must
 * match.
 */
const VERDICT_KEY_ORDER = [
  "assetId",
  "cycleId",
  "verdict",
  "observedAmount",
  "source",
] as const satisfies ReadonlyArray<keyof Verdict>;

// If Verdict gains a new field that is absent from VERDICT_KEY_ORDER, tsc
// will fail here with: Type '["Missing keys in VERDICT_KEY_ORDER: ", "<field>"]'
// is not assignable to type 'true'.
type _VerdictKeyOrderExhaustive = ExhaustiveKeyList<
  Verdict,
  (typeof VERDICT_KEY_ORDER)[number]
>;

/**
 * Deterministic length-prefixed binary encoding of a Verdict — **the value
 * that signers sign and that the on-chain `distribute()` reconstructs for
 * Ed25519 verification** (SPEC-4).
 *
 * Layout (u16 big-endian length prefixes; verdict is a single byte):
 *   [u16 assetId.len]   assetId_utf8
 *   [u16 cycleId.len]  cycleId_utf8
 *   [0x01 if verdict==="yes" else 0x00]
 *   [u16 observedAmount.len]  observedAmount_utf8
 *   [u16 source.len]    source_utf8
 *
 * Binary (not JSON) so the Odra contract can reconstruct the exact signed
 * bytes without fragile cross-language string-matching. The contract's
 * `canonical_bytes` (SPEC-4 §4) MUST produce the identical sequence.
 */
export function canonicalBytes(v: Verdict): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const pushStr = (s: string) => {
    const b = enc.encode(s);
    // u16 big-endian length, then the UTF-8 bytes
    parts.push(new Uint8Array([(b.length >> 8) & 0xff, b.length & 0xff]), b);
  };
  pushStr(v.assetId);
  pushStr(v.cycleId);
  parts.push(new Uint8Array([v.verdict === "yes" ? 1 : 0]));
  pushStr(v.observedAmount);
  pushStr(v.source);

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * SHA-256 digest of the canonical bytes — a display/provenance digest only.
 * NOT the signed value: signers sign `canonicalBytes(v)` directly (SPEC-4).
 * Kept for `verdict_hashes` provenance and consumers that want a fixed-size
 * fingerprint of a verdict.
 */
export function canonicalHash(v: Verdict): Hash {
  return bytesToHex(sha256(canonicalBytes(v)));
}

/**
 * Signs the canonical bytes of a Verdict with the given Ed25519 secret key.
 * The on-chain contract verifies the signature over the identical bytes
 * (SPEC-4 §4) — so what is signed here is exactly what `distribute()` checks.
 *
 * @param v            - The verdict to sign.
 * @param secretKeyHex - 32-byte secret key, lowercase hex.
 * @returns SignedVerdict containing the verdict, hex signature, and hex public key.
 */
export function signVerdict(v: Verdict, secretKeyHex: string): SignedVerdict {
  const secretKeyBytes = hexToBytes(secretKeyHex);
  const messageBytes = canonicalBytes(v);

  const signatureBytes = ed.sign(messageBytes, secretKeyBytes);
  const publicKeyBytes = ed.getPublicKey(secretKeyBytes);

  return {
    verdict: v,
    signature: bytesToHex(signatureBytes),
    signer: bytesToHex(publicKeyBytes),
  };
}

/**
 * Verifies that the signature in a SignedVerdict is a valid Ed25519 signature
 * over the canonical bytes of its embedded Verdict, under the stated signer
 * key. This is the off-chain mirror of the on-chain check `distribute()` now
 * performs (SPEC-4).
 *
 * Returns false (not throws) for any invalid input — malformed hex, wrong key,
 * or tampered verdict fields.
 */
export function verifyVerdict(s: SignedVerdict): boolean {
  try {
    const messageBytes = canonicalBytes(s.verdict);
    const signatureBytes = hexToBytes(s.signature);
    const publicKeyBytes = hexToBytes(s.signer);

    return ed.verify(signatureBytes, messageBytes, publicKeyBytes);
  } catch {
    // Malformed hex, wrong-length bytes, or library rejection — treat as invalid.
    return false;
  }
}
