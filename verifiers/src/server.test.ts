import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RequestHandler } from "express";
import request from "supertest";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex } from "@noble/hashes/utils";
import { verifyVerdict } from "@quittance/core";
import { buildX402GateMiddleware, createVerifierApp } from "./server.js";
import type { VerifierPaymentConfig, X402Gateway } from "./server.js";
import { fileCashflowSource } from "./cashflow-source.js";
import type { CashflowEvidence, CashflowSource } from "./verdict.js";

// @noble/ed25519 v2 requires sha512 wired in for synchronous methods.
ed.etc.sha512Sync = (...messages: Uint8Array[]) =>
  sha512(ed.etc.concatBytes(...messages));

// ---------------------------------------------------------------------------
// Helpers
//
// These tests exercise the HANDLER glue via an injected pass-through gate
// (simulating "already paid"). The real casper-x402 gate needs the hosted
// facilitator + an on-chain settlement, so its paid->200 path is verified live
// by the controller, NOT here (see the skipped test at the bottom). No test in
// this file touches the network.
// ---------------------------------------------------------------------------

function freshSigningKeyHex(): string {
  return bytesToHex(ed.utils.randomPrivateKey());
}

/** A gate that behaves as if payment already settled: always continue. */
const passThroughGate: RequestHandler = (_req, _res, next) => next();

function sourceFrom(evidence: CashflowEvidence | null): CashflowSource {
  return { fetch: async () => evidence };
}

const ASSET_ID = "inv-001";
const CYCLE_ID = "2026-06";
const PRICE_MOTES = "10000000000";
const EXPECTED_REF = "REF-ABC-001";
const LABEL = "verifier-node-1";

// A structurally-valid payment config. Values are well-formed (66-hex payTo,
// 64-hex asset) so the real-gate construction test can build requirements
// offline; no request is ever issued against the real gate here.
const PAYMENT: VerifierPaymentConfig = {
  facilitatorUrl: "https://facilitator.invalid",
  facilitatorToken: "test-token-not-used-offline",
  network: "casper:casper-test",
  asset: "3d80df21ba4ee4d66a2a1f60c32570dd5685e4b279f6538162a5fd1314847c1e",
  payTo: `00${"ab".repeat(32)}`,
  priceMotes: PRICE_MOTES,
  tokenName: "Wrapped CSPR",
  tokenVersion: "1",
  expectedReference: EXPECTED_REF,
};

const MATCHING_EVIDENCE: CashflowEvidence = {
  assetId: ASSET_ID,
  cycleId: CYCLE_ID,
  expectedAmount: PRICE_MOTES,
  observedAmount: PRICE_MOTES,
  reference: EXPECTED_REF,
};

function appWith(source: CashflowSource, gate: RequestHandler = passThroughGate) {
  return createVerifierApp({
    verifier: { source, signingKeyHex: freshSigningKeyHex(), label: LABEL },
    payment: PAYMENT,
    x402Gate: gate,
  });
}

// ---------------------------------------------------------------------------
// GET /verify — handler glue (pass-through gate)
// ---------------------------------------------------------------------------

describe("GET /verify (pass-through gate)", () => {
  it("yes: returns 200 with a genuinely-signed SignedVerdict matching the query", async () => {
    const app = appWith(sourceFrom(MATCHING_EVIDENCE));

    const res = await request(app).get(
      `/verify?asset=${ASSET_ID}&cycle=${CYCLE_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.type).toBe("application/json");
    expect(res.body.verdict.verdict).toBe("yes");
    expect(res.body.verdict.assetId).toBe(ASSET_ID);
    expect(res.body.verdict.cycleId).toBe(CYCLE_ID);
    expect(res.body.verdict.source).toBe(LABEL);
    // Prove the body is genuinely signed, not a hand-rolled mock.
    expect(verifyVerdict(res.body)).toBe(true);
  });

  it("no (missing evidence): returns 200, verdict no, observedAmount 0, still signed", async () => {
    const app = appWith(sourceFrom(null));

    const res = await request(app).get(
      `/verify?asset=${ASSET_ID}&cycle=${CYCLE_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.verdict.verdict).toBe("no");
    expect(res.body.verdict.observedAmount).toBe("0");
    expect(verifyVerdict(res.body)).toBe(true);
  });

  it("no (reference mismatch): returns 200, verdict no, still signed", async () => {
    const app = appWith(
      sourceFrom({ ...MATCHING_EVIDENCE, reference: "WRONG-REF" }),
    );

    const res = await request(app).get(
      `/verify?asset=${ASSET_ID}&cycle=${CYCLE_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.verdict.verdict).toBe("no");
    expect(verifyVerdict(res.body)).toBe(true);
  });

  it("uses priceMotes/expectedReference from payment config as the VerifyQuery", async () => {
    const fetchSpy = vi.fn(async () => MATCHING_EVIDENCE);
    const app = createVerifierApp({
      verifier: { source: { fetch: fetchSpy }, signingKeyHex: freshSigningKeyHex(), label: LABEL },
      payment: PAYMENT,
      x402Gate: passThroughGate,
    });

    await request(app).get(`/verify?asset=${ASSET_ID}&cycle=${CYCLE_ID}`);

    expect(fetchSpy).toHaveBeenCalledWith(ASSET_ID, CYCLE_ID);
  });
});

// ---------------------------------------------------------------------------
// GET /verify — request validation (must run before runVerifier)
// ---------------------------------------------------------------------------

describe("GET /verify validation (pass-through gate)", () => {
  it("missing asset: 400 with explicit error, verifier not invoked", async () => {
    const fetchSpy = vi.fn(async () => MATCHING_EVIDENCE);
    const app = createVerifierApp({
      verifier: { source: { fetch: fetchSpy }, signingKeyHex: freshSigningKeyHex(), label: LABEL },
      payment: PAYMENT,
      x402Gate: passThroughGate,
    });

    const res = await request(app).get(`/verify?cycle=${CYCLE_ID}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asset/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("missing cycle: 400 with explicit error, verifier not invoked", async () => {
    const fetchSpy = vi.fn(async () => MATCHING_EVIDENCE);
    const app = createVerifierApp({
      verifier: { source: { fetch: fetchSpy }, signingKeyHex: freshSigningKeyHex(), label: LABEL },
      payment: PAYMENT,
      x402Gate: passThroughGate,
    });

    const res = await request(app).get(`/verify?asset=${ASSET_ID}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cycle/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blank asset: 400 (whitespace/empty rejected)", async () => {
    const app = appWith(sourceFrom(MATCHING_EVIDENCE));

    const res = await request(app).get(`/verify?asset=&cycle=${CYCLE_ID}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asset/i);
  });
});

// ---------------------------------------------------------------------------
// fileCashflowSource
// ---------------------------------------------------------------------------

describe("fileCashflowSource", () => {
  let dir: string;
  let fixturePath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "quittance-verifier-"));
    fixturePath = join(dir, "evidence.json");
    const table: Record<string, CashflowEvidence> = {
      [`${ASSET_ID}:${CYCLE_ID}`]: MATCHING_EVIDENCE,
    };
    writeFileSync(fixturePath, JSON.stringify(table), "utf8");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns evidence for a known <assetId>:<cycleId> key", async () => {
    const source = fileCashflowSource(fixturePath);
    const evidence = await source.fetch(ASSET_ID, CYCLE_ID);
    expect(evidence).toEqual(MATCHING_EVIDENCE);
  });

  it("returns null for an unknown key (drives a no verdict)", async () => {
    const source = fileCashflowSource(fixturePath);
    expect(await source.fetch(ASSET_ID, "1999-01")).toBeNull();
    expect(await source.fetch("unknown", CYCLE_ID)).toBeNull();
  });

  it("drives an end-to-end yes verdict through the handler", async () => {
    const app = appWith(fileCashflowSource(fixturePath));
    const res = await request(app).get(
      `/verify?asset=${ASSET_ID}&cycle=${CYCLE_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.verdict.verdict).toBe("yes");
    expect(verifyVerdict(res.body)).toBe(true);
  });

  it("throws an actionable error for a missing file", () => {
    expect(() => fileCashflowSource(join(dir, "does-not-exist.json"))).toThrow(
      /evidence/i,
    );
  });

  it("throws an actionable error for invalid JSON", () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not valid json", "utf8");
    expect(() => fileCashflowSource(bad)).toThrow(/JSON/i);
  });

  it("throws when the fixture is not a JSON object", () => {
    const arr = join(dir, "array.json");
    writeFileSync(arr, "[]", "utf8");
    expect(() => fileCashflowSource(arr)).toThrow(/object/i);
  });
});

// ---------------------------------------------------------------------------
// Real casper-x402 gate
// ---------------------------------------------------------------------------

describe("real casper-x402 gate", () => {
  it("constructs cleanly from payment config (offline; no request issued)", () => {
    // Building the app with NO injected gate constructs the real
    // HTTPFacilitatorClient + x402ResourceServer + x402HTTPResourceServer and
    // registers the Casper exact scheme. All of that is synchronous/offline;
    // the facilitator is only contacted lazily on the first request.
    expect(() =>
      createVerifierApp({
        verifier: { source: sourceFrom(MATCHING_EVIDENCE), signingKeyHex: freshSigningKeyHex(), label: LABEL },
        payment: PAYMENT,
      }),
    ).not.toThrow();
  });

  // The unpaid -> 402 (PAYMENT-REQUIRED) path cannot be exercised offline:
  // x402HTTPResourceServer.initialize() performs GET {facilitator}/supported,
  // and building the PaymentRequirements throws without that supportedKind
  // (see @x402/core server/index.mjs buildPaymentRequirements). This path, and
  // the paid -> 200 settlement path, are verified live by the controller with
  // RECTOR's sign-off. Kept as a skipped marker for traceability.
  it.skip("real gate returns 402 + PAYMENT-REQUIRED without PAYMENT-SIGNATURE (controller-verified live)", () => {
    // intentionally skipped: requires facilitator network access
  });
});

// ---------------------------------------------------------------------------
// Deferred-settlement binding (fake X402Gateway)
//
// The real gate's settle path (buildX402GateMiddleware -> runCasperX402Gate ->
// installSettlementInterceptor -> settleThenFlush) is bypassed by the
// pass-through gate above. Here we drive it directly with a FAKE gateway whose
// processHTTPRequest returns `payment-verified` and whose processSettlement is
// stubbed — exercising the four deterministic branches offline (no network, no
// on-chain). The live verify/settle calls remain controller-verified.
// ---------------------------------------------------------------------------

const VERIFIED_REQUIREMENTS = {
  scheme: "exact",
  network: "casper:casper-test",
  asset: PAYMENT.asset,
  amount: PAYMENT.priceMotes,
  payTo: PAYMENT.payTo,
  maxTimeoutSeconds: 300,
  extra: { name: "Wrapped CSPR", version: "1" },
};

const VERIFIED_RESULT = {
  type: "payment-verified" as const,
  cancellationDispatcher: { cancel: async () => undefined },
  paymentPayload: { x402Version: 2, accepted: VERIFIED_REQUIREMENTS, payload: {} },
  paymentRequirements: VERIFIED_REQUIREMENTS,
  declaredExtensions: {},
};

const SETTLE_SUCCESS = {
  success: true,
  transaction: "ab".repeat(32),
  network: "casper:casper-test",
  headers: { "PAYMENT-RESPONSE": "c2V0dGxlZA==" },
  requirements: VERIFIED_REQUIREMENTS,
};

const SETTLE_FAILURE = {
  success: false,
  errorReason: "insufficient_funds",
  errorMessage: "insufficient_funds",
  network: "casper:casper-test",
  transaction: "",
  headers: { "PAYMENT-RESPONSE": "ZmFpbGVk" },
  response: {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-RESPONSE": "ZmFpbGVk",
    },
    body: { error: "settlement failed: insufficient_funds" },
  },
};

function appWithGateway(parts: {
  processSettlement?: ReturnType<typeof vi.fn>;
  processHTTPRequest?: ReturnType<typeof vi.fn>;
  initialize?: ReturnType<typeof vi.fn>;
  source?: CashflowSource;
}) {
  const gateway = {
    initialize: parts.initialize ?? vi.fn(async () => undefined),
    processHTTPRequest:
      parts.processHTTPRequest ?? vi.fn(async () => VERIFIED_RESULT),
    processSettlement:
      parts.processSettlement ?? vi.fn(async () => SETTLE_SUCCESS),
  };
  const app = createVerifierApp({
    verifier: {
      source: parts.source ?? sourceFrom(MATCHING_EVIDENCE),
      signingKeyHex: freshSigningKeyHex(),
      label: LABEL,
    },
    payment: PAYMENT,
    x402Gate: buildX402GateMiddleware(gateway as unknown as X402Gateway),
  });
  return { app, gateway };
}

describe("deferred-settlement binding (fake gateway)", () => {
  it("(a) 2xx verdict: settles and attaches PAYMENT-RESPONSE before flushing the body", async () => {
    const { app, gateway } = appWithGateway({});

    const res = await request(app).get(
      `/verify?asset=${ASSET_ID}&cycle=${CYCLE_ID}`,
    );

    expect(res.status).toBe(200);
    // Header present ALONGSIDE the verdict body proves the deferred flush:
    // settlement ran (and set the header) before the body was written.
    expect(res.headers["payment-response"]).toBe("c2V0dGxlZA==");
    expect(res.body.verdict.verdict).toBe("yes");
    expect(verifyVerdict(res.body)).toBe(true);
    expect(gateway.initialize).toHaveBeenCalledTimes(1);
    expect(gateway.processSettlement).toHaveBeenCalledTimes(1);
    expect(gateway.processSettlement).toHaveBeenCalledWith(
      VERIFIED_RESULT.paymentPayload,
      VERIFIED_RESULT.paymentRequirements,
      VERIFIED_RESULT.declaredExtensions,
      { request: expect.objectContaining({ path: "/verify", method: "GET" }) },
    );
  });

  it("(b) non-2xx handler response: settlement is SKIPPED (no charge for a refused request)", async () => {
    // Gate verifies payment, then the handler 400s on the missing asset param.
    const { app, gateway } = appWithGateway({});

    const res = await request(app).get(`/verify?cycle=${CYCLE_ID}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asset/i);
    expect(gateway.processSettlement).not.toHaveBeenCalled();
  });

  it("(c) settlement failure: writes the SDK's 402 instructions and discards the verdict body", async () => {
    const { app, gateway } = appWithGateway({
      processSettlement: vi.fn(async () => SETTLE_FAILURE),
    });

    const res = await request(app).get(
      `/verify?asset=${ASSET_ID}&cycle=${CYCLE_ID}`,
    );

    expect(res.status).toBe(402);
    expect(res.body).toEqual(SETTLE_FAILURE.response.body);
    expect(res.body.verdict).toBeUndefined();
    expect(res.headers["payment-response"]).toBe("ZmFpbGVk");
    expect(gateway.processSettlement).toHaveBeenCalledTimes(1);
  });

  it("(d) settlement throws: next(err) -> 500 via the error middleware", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app, gateway } = appWithGateway({
      processSettlement: vi.fn(async () => {
        throw new Error("facilitator unreachable");
      }),
    });

    const res = await request(app).get(
      `/verify?asset=${ASSET_ID}&cycle=${CYCLE_ID}`,
    );

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("verifier failed to process the request");
    expect(gateway.processSettlement).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
