import { describe, it, expect } from "vitest";
import { canonicalHash, signVerdict, verifyVerdict } from "./sign.js";
import { freshKeypair } from "./test-utils.js";
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

// ---------------------------------------------------------------------------
// VERDICT_KEY_ORDER exhaustiveness guarantee
// ---------------------------------------------------------------------------
// The compile-time guard in sign.ts (_VerdictKeyOrderExhaustive) ensures that
// every key present in the `Verdict` interface also appears in VERDICT_KEY_ORDER.
// If Verdict gains a field that is missing from the list, tsc will fail with:
//   Type '["Missing keys in VERDICT_KEY_ORDER: ", "<field>"]' is not assignable
//   to type 'true'.
// The runtime test below verifies the same invariant so the guarantee is
// visible in the test suite even without a tsc invocation.

describe("VERDICT_KEY_ORDER exhaustiveness", () => {
  it("covers every key present in a Verdict object", () => {
    const verdict: Verdict = {
      assetId: "x",
      cycleId: "x",
      verdict: "yes",
      observedAmount: "0",
      source: "x",
    };
    // Every key in the Verdict must produce a differing hash when tampered.
    // If a key were missing from VERDICT_KEY_ORDER it would be absent from the
    // canonical JSON and tampering it would NOT change the hash — the assertion
    // below would fail, exposing the gap.
    for (const field of Object.keys(verdict) as Array<keyof Verdict>) {
      const tampered = { ...verdict, [field]: "tampered" } as Verdict;
      expect(canonicalHash(tampered)).not.toBe(canonicalHash(verdict));
    }
  });
});

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
