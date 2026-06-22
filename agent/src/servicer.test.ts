import { describe, it, expect, beforeEach } from "vitest";
import { signVerdict } from "@quittance/core";
import { FakeChainClient } from "@quittance/core";
import type { SignedVerdict, Verdict } from "@quittance/core";
import { freshKeypair } from "@quittance/core/test-utils";
import { FakeVerifierClient } from "./verifier-client.js";
import type {
  FakeEndpointConfig,
  VerifierEndpoint,
  VerifierResponse,
} from "./verifier-client.js";
import { runCycle } from "./servicer.js";
import type { AssetServicingConfig } from "./servicer.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const VAULT_HASH = "fake-vault-hash-abc123";
const ASSET_ID = "inv-001";
const CYCLE_ID = "2026-06";

const ENDPOINTS: [VerifierEndpoint, VerifierEndpoint, VerifierEndpoint] = [
  { id: "v1", url: "https://verifier1.example.com/verify" },
  { id: "v2", url: "https://verifier2.example.com/verify" },
  { id: "v3", url: "https://verifier3.example.com/verify" },
];

const BASE_CFG: AssetServicingConfig = {
  assetId: ASSET_ID,
  vaultHash: VAULT_HASH,
  expectedAmount: "10000000000",
  expectedReference: "inv-001-june-2026",
  quorumRequired: 2,
  endpoints: [...ENDPOINTS],
};

// ---------------------------------------------------------------------------
// Helpers: build signed verdicts for fake verifier responses
// ---------------------------------------------------------------------------

function makeSignedVerdict(
  verdict: "yes" | "no",
  // verifierIndex is a logical label only — a fresh random key is generated each call.
  verifierIndex: number,
  opts: { assetId?: string; cycleId?: string } = {},
): SignedVerdict {
  const kp = freshKeypair();
  const v: Verdict = {
    assetId: opts.assetId ?? ASSET_ID,
    cycleId: opts.cycleId ?? CYCLE_ID,
    verdict,
    observedAmount: "10000000000",
    source: `verifier-${verifierIndex}`,
  };
  return signVerdict(v, kp.secretKeyHex);
}

function makeResponse(verdict: "yes" | "no", keyIndex: number, endpointId: string): VerifierResponse {
  return {
    receipt: {
      verifierId: endpointId,
      cycleId: CYCLE_ID,
      txHash: `fake-x402-tx-${endpointId}`,
      amountMotes: "1000000",
      settledAt: new Date().toISOString(),
    },
    verdict: makeSignedVerdict(verdict, keyIndex),
  };
}

function responseConfig(verdict: "yes" | "no", keyIndex: number, id: string): FakeEndpointConfig {
  return { kind: "response", value: makeResponse(verdict, keyIndex, id) };
}

function errorConfig(msg: string): FakeEndpointConfig {
  return { kind: "error", error: new Error(msg) };
}

// ---------------------------------------------------------------------------
// Happy path: 2 "yes" + 1 "no" → distributed
// ---------------------------------------------------------------------------

describe("runCycle — happy path (2 yes + 1 no → distributed)", () => {
  let chain: FakeChainClient;
  let verifier: FakeVerifierClient;

  beforeEach(() => {
    chain = new FakeChainClient();
    // queryDictItem returns undefined (not distributed) by default.

    const endpoints = new Map<string, FakeEndpointConfig>([
      ["v1", responseConfig("yes", 1, "v1")],
      ["v2", responseConfig("yes", 2, "v2")],
      ["v3", responseConfig("no", 3, "v3")],
    ]);
    verifier = new FakeVerifierClient({ endpoints });
  });

  it("returns status 'distributed'", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.status).toBe("distributed");
  });

  it("has distributeTx set", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.distributeTx).toBeTruthy();
  });

  it("receipts.length === 3 (all 3 verifiers paid)", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.receipts).toHaveLength(3);
  });

  it("verdicts.length === 3 (all 3 verdicts collected)", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.verdicts).toHaveLength(3);
  });

  it("callEntrypoint('distribute', …) called exactly once", async () => {
    await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    const distributeCalls = chain.calls.filter(
      (c) => c.method === "callEntrypoint" && (c.args as unknown[])[1] === "distribute",
    );
    expect(distributeCalls).toHaveLength(1);
  });

  it("distribute args include asset_id, cycle_id, verdict_hashes, signers", async () => {
    await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    const distributeCall = chain.calls.find(
      (c) => c.method === "callEntrypoint" && (c.args as unknown[])[1] === "distribute",
    );
    expect(distributeCall).toBeDefined();
    const args = (distributeCall!.args as unknown[])[2] as Record<string, unknown>;
    expect(args["asset_id"]).toBe(ASSET_ID);
    expect(args["cycle_id"]).toBe(CYCLE_ID);
    expect(Array.isArray(args["verdict_hashes"])).toBe(true);
    expect(Array.isArray(args["signers"])).toBe(true);
  });

  it("no reason set on success", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.reason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fraud path: 2 "no" + 1 "yes" → quorum_not_met
// ---------------------------------------------------------------------------

describe("runCycle — fraud path (2 no + 1 yes → quorum_not_met)", () => {
  let chain: FakeChainClient;
  let verifier: FakeVerifierClient;

  beforeEach(() => {
    chain = new FakeChainClient();

    const endpoints = new Map<string, FakeEndpointConfig>([
      ["v1", responseConfig("no", 1, "v1")],
      ["v2", responseConfig("no", 2, "v2")],
      ["v3", responseConfig("yes", 3, "v3")],
    ]);
    verifier = new FakeVerifierClient({ endpoints });
  });

  it("returns status 'halted'", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.status).toBe("halted");
  });

  it("reason is 'quorum_not_met'", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.reason).toBe("quorum_not_met");
  });

  it("distribute NOT called", async () => {
    await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    const distributeCalls = chain.calls.filter(
      (c) => c.method === "callEntrypoint" && (c.args as unknown[])[1] === "distribute",
    );
    expect(distributeCalls).toHaveLength(0);
  });

  it("distributeTx not set", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.distributeTx).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Double-distribute guard: already distributed → halt immediately, no verifier paid
// ---------------------------------------------------------------------------

describe("runCycle — double-distribute guard", () => {
  let chain: FakeChainClient;
  let verifier: FakeVerifierClient;

  beforeEach(() => {
    chain = new FakeChainClient();
    // Simulate already-distributed entry in the chain dict.
    chain.setDictItem(VAULT_HASH, "distributed", `${ASSET_ID}:${CYCLE_ID}`, true);

    // All verifiers would say "yes" — but they must NEVER be called.
    const endpoints = new Map<string, FakeEndpointConfig>([
      ["v1", responseConfig("yes", 1, "v1")],
      ["v2", responseConfig("yes", 2, "v2")],
      ["v3", responseConfig("yes", 3, "v3")],
    ]);
    verifier = new FakeVerifierClient({ endpoints });
  });

  it("returns status 'halted'", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.status).toBe("halted");
  });

  it("reason is 'already_distributed'", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.reason).toBe("already_distributed");
  });

  it("no verifier was paid (FakeVerifierClient invocations === 0)", async () => {
    await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(verifier.invocations).toHaveLength(0);
  });

  it("receipts and verdicts are empty", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.receipts).toHaveLength(0);
    expect(outcome.verdicts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// All payments fail: every query throws (even after retry) → payment_failed
// ---------------------------------------------------------------------------

describe("runCycle — all payments fail → payment_failed", () => {
  let chain: FakeChainClient;
  let verifier: FakeVerifierClient;

  beforeEach(() => {
    chain = new FakeChainClient();
    // Every endpoint throws, always.
    verifier = new FakeVerifierClient({
      fallback: errorConfig("network timeout"),
    });
  });

  it("returns status 'halted'", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.status).toBe("halted");
  });

  it("reason is 'payment_failed'", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.reason).toBe("payment_failed");
  });

  it("distribute NOT called", async () => {
    await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    const distributeCalls = chain.calls.filter(
      (c) => c.method === "callEntrypoint" && (c.args as unknown[])[1] === "distribute",
    );
    expect(distributeCalls).toHaveLength(0);
  });

  it("receipts and verdicts are empty", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.receipts).toHaveLength(0);
    expect(outcome.verdicts).toHaveLength(0);
  });

  it("each endpoint was attempted twice (initial + 1 retry)", async () => {
    await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    // 3 endpoints × 2 attempts each = 6 total invocations
    expect(verifier.invocations).toHaveLength(6);
  });

  it("outcome.errors contains one entry per failed endpoint with endpointId and message", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    // 3 endpoints all failed — each should appear in errors with a message.
    expect(outcome.errors).toHaveLength(3);
    const ids = outcome.errors.map((e) => e.endpointId);
    expect(ids).toContain("v1");
    expect(ids).toContain("v2");
    expect(ids).toContain("v3");
    for (const e of outcome.errors) {
      expect(typeof e.message).toBe("string");
      expect(e.message.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Partial responses: only 1 of 3 responds → insufficient_responses
// ---------------------------------------------------------------------------

describe("runCycle — partial responses (1 of 3 responds → insufficient_responses)", () => {
  let chain: FakeChainClient;
  let verifier: FakeVerifierClient;

  beforeEach(() => {
    chain = new FakeChainClient();
    // Only v1 responds; v2 and v3 always throw.
    const endpoints = new Map<string, FakeEndpointConfig>([
      ["v1", responseConfig("yes", 1, "v1")],
      ["v2", errorConfig("v2 timeout")],
      ["v3", errorConfig("v3 timeout")],
    ]);
    verifier = new FakeVerifierClient({ endpoints });
  });

  it("returns status 'halted'", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.status).toBe("halted");
  });

  it("reason is 'insufficient_responses'", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.reason).toBe("insufficient_responses");
  });

  it("distribute NOT called", async () => {
    await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    const distributeCalls = chain.calls.filter(
      (c) => c.method === "callEntrypoint" && (c.args as unknown[])[1] === "distribute",
    );
    expect(distributeCalls).toHaveLength(0);
  });

  it("receipts has 1 entry (the one that succeeded)", async () => {
    const outcome = await runCycle({ verifierClient: verifier, chainClient: chain }, BASE_CFG, CYCLE_ID);
    expect(outcome.receipts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Retry behaviour: endpoint throws once then succeeds on retry
// ---------------------------------------------------------------------------

describe("runCycle — retry behaviour (throws once, succeeds on retry)", () => {
  it("counts a response that succeeded on retry, does not double-count it", async () => {
    const chain = new FakeChainClient();
    let v2CallCount = 0;
    const v2Response = makeResponse("yes", 2, "v2");

    // Build a custom FakeVerifierClient that throws on the first call for v2
    // but succeeds on the second.
    class FlakeyVerifierClient extends FakeVerifierClient {
      override async query(
        endpoint: VerifierEndpoint,
        q: import("@quittance/verifier").VerifyQuery,
      ): Promise<VerifierResponse> {
        if (endpoint.id === "v2") {
          v2CallCount++;
          // Record every attempt (including the one that throws) for consistency
          // with FakeVerifierClient which pushes before resolving/rejecting.
          this.invocations.push({ endpoint, query: q });
          if (v2CallCount === 1) throw new Error("transient network error");
          return v2Response;
        }
        return super.query(endpoint, q);
      }
    }

    const endpoints = new Map<string, FakeEndpointConfig>([
      ["v1", responseConfig("yes", 1, "v1")],
      ["v2", responseConfig("yes", 2, "v2")], // config not used — overridden
      ["v3", responseConfig("no", 3, "v3")],
    ]);
    const verifier = new FlakeyVerifierClient({ endpoints });

    const outcome = await runCycle(
      { verifierClient: verifier, chainClient: chain },
      BASE_CFG,
      CYCLE_ID,
    );

    // v2 succeeded on retry → quorum should pass (yes: v1 + v2, no: v3)
    expect(outcome.status).toBe("distributed");
    expect(outcome.receipts).toHaveLength(3);
  });
});
