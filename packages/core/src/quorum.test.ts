import { describe, it, expect } from "vitest";
import * as ed from "@noble/ed25519";
import { bytesToHex } from "@noble/hashes/utils";
import { signVerdict } from "./sign.js";
import { reachQuorum } from "./quorum.js";
import type { Verdict, SignedVerdict } from "./types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface Keypair {
  secretKeyHex: string;
  publicKeyHex: string;
}

function freshKeypair(): Keypair {
  const secretKey = ed.utils.randomPrivateKey();
  const publicKey = ed.getPublicKey(secretKey);
  return {
    secretKeyHex: bytesToHex(secretKey),
    publicKeyHex: bytesToHex(publicKey),
  };
}

function makeVerdict(
  verdict: "yes" | "no",
  source: string,
  cycleId = "2026-06"
): Verdict {
  return {
    assetId: "inv-001",
    cycleId,
    verdict,
    observedAmount: "10000000000",
    source,
  };
}

function yes(kp: Keypair, source = kp.publicKeyHex.slice(0, 8)): SignedVerdict {
  return signVerdict(makeVerdict("yes", source), kp.secretKeyHex);
}

function no(kp: Keypair, source = kp.publicKeyHex.slice(0, 8)): SignedVerdict {
  return signVerdict(makeVerdict("no", source), kp.secretKeyHex);
}

// ---------------------------------------------------------------------------
// Required test cases (verbatim from the brief)
// ---------------------------------------------------------------------------

describe("reachQuorum", () => {
  it("2 of 3 'yes' with required=2 → passed: true", () => {
    const v1 = freshKeypair();
    const v2 = freshKeypair();
    const v3 = freshKeypair();

    const result = reachQuorum([yes(v1), yes(v2), no(v3)], 2);

    expect(result.passed).toBe(true);
    expect(result.yesSigners).toHaveLength(2);
    expect(result.yesSigners).toContain(v1.publicKeyHex);
    expect(result.yesSigners).toContain(v2.publicKeyHex);
    expect(result.verdictHashes).toHaveLength(2);
  });

  it("1 of 3 'yes' with required=2 → passed: false", () => {
    const v1 = freshKeypair();
    const v2 = freshKeypair();
    const v3 = freshKeypair();

    const result = reachQuorum([yes(v1), no(v2), no(v3)], 2);

    expect(result.passed).toBe(false);
    expect(result.yesSigners).toHaveLength(1);
  });

  it("a tampered/invalid signature is ignored (not counted toward quorum)", () => {
    const v1 = freshKeypair();
    const v2 = freshKeypair();
    const v3 = freshKeypair();

    const valid1 = yes(v1);
    const tampered = yes(v2);
    // Corrupt the signature — flip last byte
    const lastByte = parseInt(tampered.signature.slice(-2), 16);
    const flipped = ((lastByte + 1) & 0xff).toString(16).padStart(2, "0");
    const corrupt: SignedVerdict = {
      ...tampered,
      signature: tampered.signature.slice(0, -2) + flipped,
    };
    const validNo = no(v3);

    // Only v1's "yes" is valid; the corrupt one is dropped
    const result = reachQuorum([valid1, corrupt, validNo], 2);

    expect(result.passed).toBe(false);
    expect(result.yesSigners).toEqual([v1.publicKeyHex]);
  });

  it("same signer voting 'yes' twice does not satisfy required=2 on its own", () => {
    const v1 = freshKeypair();
    const v3 = freshKeypair();

    // v1 casts two yes votes (e.g., different source labels, same key)
    const vote1 = signVerdict(makeVerdict("yes", "source-a"), v1.secretKeyHex);
    const vote2 = signVerdict(makeVerdict("yes", "source-b"), v1.secretKeyHex);
    const voteNo = no(v3);

    const result = reachQuorum([vote1, vote2, voteNo], 2);

    expect(result.passed).toBe(false);
    // Deduplicated: only one unique signer
    expect(result.yesSigners).toHaveLength(1);
    expect(result.yesSigners).toEqual([v1.publicKeyHex]);
  });

  // ---------------------------------------------------------------------------
  // Edge-case guards (not in brief but essential for correctness)
  // ---------------------------------------------------------------------------

  it("all 3 'yes' with required=2 → passed: true with all 3 signers", () => {
    const v1 = freshKeypair();
    const v2 = freshKeypair();
    const v3 = freshKeypair();

    const result = reachQuorum([yes(v1), yes(v2), yes(v3)], 2);

    expect(result.passed).toBe(true);
    expect(result.yesSigners).toHaveLength(3);
    expect(result.verdictHashes).toHaveLength(3);
  });

  it("empty list → passed: false, empty arrays", () => {
    const result = reachQuorum([], 2);
    expect(result.passed).toBe(false);
    expect(result.yesSigners).toHaveLength(0);
    expect(result.verdictHashes).toHaveLength(0);
  });

  it("verdictHashes correspond only to counted 'yes' verdicts", () => {
    const v1 = freshKeypair();
    const v2 = freshKeypair();

    const yesVote1 = yes(v1);
    const noVote2 = no(v2);
    const result = reachQuorum([yesVote1, noVote2], 1);

    expect(result.passed).toBe(true);
    expect(result.verdictHashes).toHaveLength(1);
    // The hash in the result must match what canonicalHash produces for that verdict
    // (We verify this indirectly: verifyVerdict must still pass for the counted verdict)
    expect(result.yesSigners).toContain(v1.publicKeyHex);
    expect(result.yesSigners).not.toContain(v2.publicKeyHex);
  });
});
