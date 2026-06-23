import { describe, expect, it } from "vitest";
import { signVerdict } from "@quittance/core";
import type { SignedVerdict, Verdict } from "@quittance/core";
import { freshKeypair } from "@quittance/core/test-utils";
import type { VerifyQuery } from "@quittance/verifier";
import type { VerifierEndpoint } from "@quittance/agent";
import { encodePaymentResponseHeader } from "@x402/core/http";
import type { ClientCasperSigner } from "@make-software/casper-x402";
import { CasperVerifierClient } from "./casper-verifier-client.js";

// ---------------------------------------------------------------------------
// Test doubles
//
// The 402 -> sign -> retry mechanics are casper-x402's responsibility and are
// NOT exercised here: the fake verifier returns 200 directly, so the injected
// fetch passes straight through wrapFetchWithPayment and the signer is never
// invoked. These tests prove the adapter's OWN logic: URL construction, body
// validation, signature trust (verifyVerdict), and the
// SettleResponse -> SettlementReceipt field mapping.
// ---------------------------------------------------------------------------

/** Minimal ClientCasperSigner — only present so ExactCasperScheme can be
 *  constructed; none of its methods run on the non-402 (200) path. */
const fakeSigner: ClientCasperSigner = {
  accountAddress: () => "00" + "ab".repeat(32),
  publicKey: () => "01" + "cd".repeat(32),
  signEIP712: async () => new Uint8Array(65),
};

const ENDPOINT: VerifierEndpoint = {
  id: "verifier-bank-feed",
  url: "https://verifier.example/verify",
};

const QUERY: VerifyQuery = {
  assetId: "asset-001",
  cycleId: "cycle-2026-06",
  expectedAmount: "1000000000",
  expectedReference: "INV-42",
};

/** A SettleResponse exactly as casper-x402's facilitator returns it; encoded to
 *  the base64 PAYMENT-RESPONSE header via the package's own encoder so the
 *  adapter decodes the real format, not a guessed one. */
function settlementHeader(overrides: {
  transaction: string;
  amount?: string;
  payer?: string;
}): string {
  return encodePaymentResponseHeader({
    success: true,
    network: "casper:casper-test",
    transaction: overrides.transaction,
    ...(overrides.amount !== undefined ? { amount: overrides.amount } : {}),
    ...(overrides.payer !== undefined ? { payer: overrides.payer } : {}),
  });
}

/** Build a valid signed "yes" verdict matching the query, with real Ed25519. */
function signedYesVerdict(q: VerifyQuery): SignedVerdict {
  const kp = freshKeypair();
  const verdict: Verdict = {
    assetId: q.assetId,
    cycleId: q.cycleId,
    verdict: "yes",
    observedAmount: q.expectedAmount,
    source: "bank-feed",
  };
  return signVerdict(verdict, kp.secretKeyHex);
}

/** A fetch impl that records the Request it was called with and returns a fixed
 *  Response. wrapFetchWithPayment passes the inner call a Request object. */
function recordingFetch(response: Response): {
  fetchImpl: typeof fetch;
  calls: Request[];
} {
  const calls: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(new Request(input, init));
    return response.clone();
  };
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status: number, header?: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (header !== undefined) headers["PAYMENT-RESPONSE"] = header;
  return new Response(JSON.stringify(body), { status, headers });
}

describe("CasperVerifierClient", () => {
  it("happy path: returns the signed verdict and a receipt mapped from the settlement header", async () => {
    const verdict = signedYesVerdict(QUERY);
    // Use an `amount` that DIFFERS from QUERY.expectedAmount to prove the
    // facilitator-reported amount takes precedence over the fallback.
    const header = settlementHeader({
      transaction: "deadbeefcafe0123",
      amount: "999",
      payer: "01" + "ef".repeat(32),
    });
    const { fetchImpl, calls } = recordingFetch(jsonResponse(verdict, 200, header));

    const client = new CasperVerifierClient({ signer: fakeSigner }, { fetchImpl });
    const res = await client.query(ENDPOINT, QUERY);

    // verdict echoed verbatim
    expect(res.verdict).toEqual(verdict);

    // receipt mapped from SettleResponse: transaction -> txHash, amount -> amountMotes
    expect(res.receipt.verifierId).toBe(ENDPOINT.id);
    expect(res.receipt.cycleId).toBe(QUERY.cycleId);
    expect(res.receipt.txHash).toBe("deadbeefcafe0123");
    expect(res.receipt.amountMotes).toBe("999");
    // settledAt is generated at receive time (SettleResponse carries no timestamp)
    expect(() => new Date(res.receipt.settledAt).toISOString()).not.toThrow();
    expect(new Date(res.receipt.settledAt).toISOString()).toBe(res.receipt.settledAt);

    // URL carries the query as encoded params
    expect(calls).toHaveLength(1);
    const url = calls[0]!.url;
    expect(url).toContain(`asset=${encodeURIComponent(QUERY.assetId)}`);
    expect(url).toContain(`cycle=${encodeURIComponent(QUERY.cycleId)}`);
  });

  it("exact-scheme settlement (no `amount` in header): amountMotes falls back to the expected amount", async () => {
    // casper-x402's Casper *exact* scheme settle() returns no `amount` field.
    const verdict = signedYesVerdict(QUERY);
    const header = settlementHeader({ transaction: "abc123", payer: "01" + "ef".repeat(32) });
    const { fetchImpl } = recordingFetch(jsonResponse(verdict, 200, header));

    const client = new CasperVerifierClient({ signer: fakeSigner }, { fetchImpl });
    const res = await client.query(ENDPOINT, QUERY);

    expect(res.receipt.txHash).toBe("abc123");
    expect(res.receipt.amountMotes).toBe(QUERY.expectedAmount);
  });

  it("bad status: throws an error naming the verifier id and status", async () => {
    const { fetchImpl } = recordingFetch(jsonResponse({ error: "upstream" }, 502));
    const client = new CasperVerifierClient({ signer: fakeSigner }, { fetchImpl });

    await expect(client.query(ENDPOINT, QUERY)).rejects.toThrow(
      new RegExp(`${ENDPOINT.id}.*502|502.*${ENDPOINT.id}`),
    );
  });

  it("malformed body: 200 but body is not a SignedVerdict -> throws", async () => {
    const header = settlementHeader({ transaction: "abc123", amount: "5" });
    const { fetchImpl } = recordingFetch(
      jsonResponse({ not: "a verdict" }, 200, header),
    );
    const client = new CasperVerifierClient({ signer: fakeSigner }, { fetchImpl });

    await expect(client.query(ENDPOINT, QUERY)).rejects.toThrow(/malformed|invalid|verdict/i);
  });

  it("body verdict does not match the query -> throws", async () => {
    const mismatched = signedYesVerdict({ ...QUERY, cycleId: "some-other-cycle" });
    const header = settlementHeader({ transaction: "abc123", amount: "5" });
    const { fetchImpl } = recordingFetch(jsonResponse(mismatched, 200, header));
    const client = new CasperVerifierClient({ signer: fakeSigner }, { fetchImpl });

    await expect(client.query(ENDPOINT, QUERY)).rejects.toThrow(/match|mismatch|cycle/i);
  });

  it("invalid signature: 200 + verdict whose signature fails verifyVerdict -> throws", async () => {
    const good = signedYesVerdict(QUERY);
    // Tamper the signature so verifyVerdict() rejects it.
    const tampered: SignedVerdict = {
      ...good,
      signature: good.signature.replace(/.$/, (c) => (c === "0" ? "1" : "0")),
    };
    const header = settlementHeader({ transaction: "abc123", amount: "5" });
    const { fetchImpl } = recordingFetch(jsonResponse(tampered, 200, header));
    const client = new CasperVerifierClient({ signer: fakeSigner }, { fetchImpl });

    await expect(client.query(ENDPOINT, QUERY)).rejects.toThrow(/signature/i);
  });

  it("missing settlement header: 200 + valid verdict but no PAYMENT-RESPONSE -> throws", async () => {
    const verdict = signedYesVerdict(QUERY);
    const { fetchImpl } = recordingFetch(jsonResponse(verdict, 200));
    const client = new CasperVerifierClient({ signer: fakeSigner }, { fetchImpl });

    await expect(client.query(ENDPOINT, QUERY)).rejects.toThrow(/settle|payment.?response|header/i);
  });

  it("settlement reports failure (success:false) -> throws", async () => {
    const verdict = signedYesVerdict(QUERY);
    const failHeader = encodePaymentResponseHeader({
      success: false,
      network: "casper:casper-test",
      transaction: "",
      errorReason: "insufficient_funds",
    });
    const { fetchImpl } = recordingFetch(jsonResponse(verdict, 200, failHeader));
    const client = new CasperVerifierClient({ signer: fakeSigner }, { fetchImpl });

    await expect(client.query(ENDPOINT, QUERY)).rejects.toThrow(/settle|insufficient_funds|fail/i);
  });
});

// ---------------------------------------------------------------------------
// Integration (creds-gated) — a real paid GET against a configured verifier.
// Skipped by default; runs only with RUN_TESTNET=1 plus the x402 env wired in.
// ---------------------------------------------------------------------------
describe.skipIf(!process.env.RUN_TESTNET)("CasperVerifierClient (testnet)", () => {
  it("pays a live verifier and returns a real settlement", async () => {
    const secretKeyPath = process.env.CASPER_SECRET_KEY_PATH;
    const verifierUrl = process.env.QUITTANCE_TESTNET_VERIFIER_URL;
    if (!secretKeyPath || !verifierUrl) {
      throw new Error(
        "RUN_TESTNET set but CASPER_SECRET_KEY_PATH / QUITTANCE_TESTNET_VERIFIER_URL missing",
      );
    }

    const client = new CasperVerifierClient({ secretKeyPath });
    const endpoint: VerifierEndpoint = { id: "testnet-verifier", url: verifierUrl };
    const res = await client.query(endpoint, QUERY);

    expect(res.receipt.txHash.length).toBeGreaterThan(0);
    expect(res.verdict.signature.length).toBeGreaterThan(0);
  });
});
