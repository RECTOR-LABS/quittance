import { describe, it, expect } from "vitest";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex } from "@noble/hashes/utils";
import { verifyVerdict } from "@quittance/core";
import { runVerifier } from "./verifier.js";
import type { VerifierConfig, VerifyQuery } from "./verifier.js";
import type { CashflowEvidence, CashflowSource } from "./verdict.js";

// @noble/ed25519 v2 requires sha512 wired in for synchronous methods.
ed.etc.sha512Sync = (...messages: Uint8Array[]) =>
  sha512(ed.etc.concatBytes(...messages));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshKeypair(): { secretKeyHex: string; publicKeyHex: string } {
  const secretKey = ed.utils.randomPrivateKey();
  const publicKey = ed.getPublicKey(secretKey);
  return {
    secretKeyHex: bytesToHex(secretKey),
    publicKeyHex: bytesToHex(publicKey),
  };
}

function makeSource(evidence: CashflowEvidence | null): CashflowSource {
  return {
    fetch: async (_assetId, _cycleId) => evidence,
  };
}

// ---------------------------------------------------------------------------
// runVerifier()
// ---------------------------------------------------------------------------

describe("runVerifier", () => {
  const ASSET_ID = "inv-001";
  const CYCLE_ID = "2026-06";
  const EXPECTED_AMOUNT = "10000000000";
  const EXPECTED_REF = "REF-ABC-001";
  const LABEL = "verifier-node-1";

  const FULL_EVIDENCE: CashflowEvidence = {
    assetId: ASSET_ID,
    cycleId: CYCLE_ID,
    expectedAmount: EXPECTED_AMOUNT,
    observedAmount: EXPECTED_AMOUNT,
    reference: EXPECTED_REF,
  };

  const BASE_QUERY: VerifyQuery = {
    assetId: ASSET_ID,
    cycleId: CYCLE_ID,
    expectedAmount: EXPECTED_AMOUNT,
    expectedReference: EXPECTED_REF,
  };

  it("yes path: returns a SignedVerdict that passes verifyVerdict", async () => {
    const { secretKeyHex } = freshKeypair();
    const cfg: VerifierConfig = {
      source: makeSource(FULL_EVIDENCE),
      signingKeyHex: secretKeyHex,
      label: LABEL,
    };

    const signed = await runVerifier(cfg, BASE_QUERY);

    expect(signed.verdict.verdict).toBe("yes");
    expect(verifyVerdict(signed)).toBe(true);
  });

  it("no path (short payment): returns a signed verdict: no that passes verifyVerdict", async () => {
    const { secretKeyHex } = freshKeypair();
    const shortEvidence: CashflowEvidence = {
      ...FULL_EVIDENCE,
      observedAmount: "1",
    };
    const cfg: VerifierConfig = {
      source: makeSource(shortEvidence),
      signingKeyHex: secretKeyHex,
      label: LABEL,
    };

    const signed = await runVerifier(cfg, BASE_QUERY);

    expect(signed.verdict.verdict).toBe("no");
    expect(verifyVerdict(signed)).toBe(true);
  });

  it("source field equals cfg.label", async () => {
    const { secretKeyHex } = freshKeypair();
    const cfg: VerifierConfig = {
      source: makeSource(FULL_EVIDENCE),
      signingKeyHex: secretKeyHex,
      label: LABEL,
    };

    const signed = await runVerifier(cfg, BASE_QUERY);

    expect(signed.verdict.source).toBe(LABEL);
  });

  it("observedAmount reflects evidence when evidence is present", async () => {
    const { secretKeyHex } = freshKeypair();
    const evidence: CashflowEvidence = {
      ...FULL_EVIDENCE,
      observedAmount: "5000000000",
    };
    const cfg: VerifierConfig = {
      source: makeSource(evidence),
      signingKeyHex: secretKeyHex,
      label: LABEL,
    };

    const signed = await runVerifier(cfg, BASE_QUERY);

    expect(signed.verdict.observedAmount).toBe("5000000000");
  });

  it("observedAmount is '0' when evidence is null", async () => {
    const { secretKeyHex } = freshKeypair();
    const cfg: VerifierConfig = {
      source: makeSource(null),
      signingKeyHex: secretKeyHex,
      label: LABEL,
    };

    const signed = await runVerifier(cfg, BASE_QUERY);

    expect(signed.verdict.verdict).toBe("no");
    expect(signed.verdict.observedAmount).toBe("0");
    expect(verifyVerdict(signed)).toBe(true);
  });
});
