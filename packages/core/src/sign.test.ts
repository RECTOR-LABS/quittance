import { describe, it, expect } from "vitest";
import * as ed from "@noble/ed25519";
import { bytesToHex } from "@noble/hashes/utils";
import { canonicalHash, signVerdict, verifyVerdict } from "./sign.js";
import type { Verdict } from "./types.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const baseVerdict: Verdict = {
  assetId: "inv-001",
  cycleId: "2026-06",
  verdict: "yes",
  observedAmount: "10000000000",
  source: "bank-api-v1",
};

function freshKeypair(): { secretKeyHex: string; publicKeyHex: string } {
  const secretKey = ed.utils.randomPrivateKey();
  const publicKey = ed.getPublicKey(secretKey);
  return {
    secretKeyHex: bytesToHex(secretKey),
    publicKeyHex: bytesToHex(publicKey),
  };
}

// ---------------------------------------------------------------------------
// canonicalHash
// ---------------------------------------------------------------------------

describe("canonicalHash", () => {
  it("returns a 64-character hex string (32 bytes)", () => {
    const hash = canonicalHash(baseVerdict);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: same verdict always produces the same hash", () => {
    expect(canonicalHash(baseVerdict)).toBe(canonicalHash({ ...baseVerdict }));
  });

  it("differs when any field changes", () => {
    const fields: Array<keyof Verdict> = [
      "assetId",
      "cycleId",
      "verdict",
      "observedAmount",
      "source",
    ];
    for (const field of fields) {
      const mutated = { ...baseVerdict, [field]: "tampered" } as Verdict;
      expect(canonicalHash(mutated)).not.toBe(canonicalHash(baseVerdict));
    }
  });

  it("is stable regardless of key insertion order in the input object", () => {
    // Build a verdict with properties in a different insertion order.
    const shuffled: Verdict = {
      source: baseVerdict.source,
      observedAmount: baseVerdict.observedAmount,
      verdict: baseVerdict.verdict,
      cycleId: baseVerdict.cycleId,
      assetId: baseVerdict.assetId,
    };
    expect(canonicalHash(shuffled)).toBe(canonicalHash(baseVerdict));
  });
});

// ---------------------------------------------------------------------------
// signVerdict / verifyVerdict — round-trip
// ---------------------------------------------------------------------------

describe("signVerdict / verifyVerdict", () => {
  it("round-trip: verifyVerdict(signVerdict(v, k)) returns true", () => {
    const { secretKeyHex, publicKeyHex } = freshKeypair();
    const signed = signVerdict(baseVerdict, secretKeyHex);

    expect(signed.signer).toBe(publicKeyHex);
    expect(signed.signature).toMatch(/^[0-9a-f]{128}$/); // 64-byte signature
    expect(verifyVerdict(signed)).toBe(true);
  });

  it("tampering with verdict.assetId makes verifyVerdict return false", () => {
    const { secretKeyHex } = freshKeypair();
    const signed = signVerdict(baseVerdict, secretKeyHex);
    const tampered = {
      ...signed,
      verdict: { ...signed.verdict, assetId: "TAMPERED" },
    };
    expect(verifyVerdict(tampered)).toBe(false);
  });

  it("tampering with verdict.cycleId makes verifyVerdict return false", () => {
    const { secretKeyHex } = freshKeypair();
    const signed = signVerdict(baseVerdict, secretKeyHex);
    const tampered = {
      ...signed,
      verdict: { ...signed.verdict, cycleId: "TAMPERED" },
    };
    expect(verifyVerdict(tampered)).toBe(false);
  });

  it("tampering with verdict.verdict field makes verifyVerdict return false", () => {
    const { secretKeyHex } = freshKeypair();
    const signed = signVerdict(baseVerdict, secretKeyHex);
    const tampered = {
      ...signed,
      verdict: { ...signed.verdict, verdict: "no" as const },
    };
    expect(verifyVerdict(tampered)).toBe(false);
  });

  it("tampering with verdict.observedAmount makes verifyVerdict return false", () => {
    const { secretKeyHex } = freshKeypair();
    const signed = signVerdict(baseVerdict, secretKeyHex);
    const tampered = {
      ...signed,
      verdict: { ...signed.verdict, observedAmount: "999" },
    };
    expect(verifyVerdict(tampered)).toBe(false);
  });

  it("tampering with verdict.source makes verifyVerdict return false", () => {
    const { secretKeyHex } = freshKeypair();
    const signed = signVerdict(baseVerdict, secretKeyHex);
    const tampered = {
      ...signed,
      verdict: { ...signed.verdict, source: "evil-source" },
    };
    expect(verifyVerdict(tampered)).toBe(false);
  });

  it("a signature produced with a different key fails verification", () => {
    const { secretKeyHex } = freshKeypair();
    const { publicKeyHex: otherPublicKeyHex } = freshKeypair();

    const signed = signVerdict(baseVerdict, secretKeyHex);
    // Swap the signer to a different public key — sig no longer matches
    const spoofed = { ...signed, signer: otherPublicKeyHex };
    expect(verifyVerdict(spoofed)).toBe(false);
  });

  it("altering the raw signature bytes makes verifyVerdict return false", () => {
    const { secretKeyHex } = freshKeypair();
    const signed = signVerdict(baseVerdict, secretKeyHex);
    // Flip the last two hex chars (last byte of signature)
    const lastByte = parseInt(signed.signature.slice(-2), 16);
    const flipped = ((lastByte + 1) & 0xff).toString(16).padStart(2, "0");
    const corrupted = {
      ...signed,
      signature: signed.signature.slice(0, -2) + flipped,
    };
    expect(verifyVerdict(corrupted)).toBe(false);
  });
});
