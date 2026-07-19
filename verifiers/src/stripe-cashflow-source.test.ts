import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stripeCashflowSource, loadStripePaymentIndex } from "./stripe-cashflow-source.js";
import type { StripePaymentIndex, StripeSourceConfig } from "./stripe-cashflow-source.js";
import { decide } from "./verdict.js";
import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// Unit tests for the Stripe-backed CashflowSource.
//
// All tests use an injected fake `fetch` — the source NEVER touches the Stripe
// API. The fake asserts the outgoing Authorization header + URL path (S11),
// proving the source talks to Stripe correctly without hitting it.
// ---------------------------------------------------------------------------

const API_KEY = "sk_test_DEADBEEFEXAMPLEKEY1234";

const INDEX: StripePaymentIndex = {
  "inv-001:happy": {
    paymentIntentId: "pi_3OabcEXAMPLE",
    expectedAmount: "1000",
  },
  "inv-001:fraud": {
    paymentIntentId: "pi_3OfraudEXAMPLE",
    expectedAmount: "1000",
  },
};

/** Build a minimal Response-ish object the source can consume. */
function stripeResponse(
  status: number,
  body: unknown,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** A PaymentIntent body builder. */
function pi(
  overrides: Partial<{
    status: string;
    amount: number;
    metadata: Record<string, string> | null;
  }>,
): unknown {
  return {
    id: "pi_3OabcEXAMPLE",
    object: "payment_intent",
    status: "succeeded",
    amount: 1000,
    metadata: { reference: "INV-001" },
    ...overrides,
  };
}

/** Capture the outgoing request (url + headers) for S11 assertions. */
function fakeFetch(
  response: Response,
): { fetch: typeof fetch; calls: { url: string; auth: string }[] } {
  const calls: { url: string; auth: string }[] = [];
  const fetchFn = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = init?.headers as Record<string, string> | undefined;
    const auth = headers?.Authorization ?? "";
    calls.push({ url, auth });
    return response;
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, calls };
}

function makeSource(
  fetchImpl: typeof fetch,
  index: StripePaymentIndex = INDEX,
): ReturnType<typeof stripeCashflowSource> {
  const cfg: StripeSourceConfig = {
    apiKey: API_KEY,
    paymentIndex: index,
    fetchImpl,
  };
  return stripeCashflowSource(cfg);
}

// ---------------------------------------------------------------------------
// Success + decision paths
// ---------------------------------------------------------------------------

describe("stripeCashflowSource — success paths", () => {
  it("S1: succeeded + ref match + amount >= expected -> evidence -> decide yes", async () => {
    const { fetch, calls } = fakeFetch(stripeResponse(200, pi({})));
    const source = makeSource(fetch);

    const evidence = await source.fetch("inv-001", "happy");
    expect(evidence).not.toBeNull();
    expect(evidence).toMatchObject({
      assetId: "inv-001",
      cycleId: "happy",
      expectedAmount: "1000",
      observedAmount: "1000",
      reference: "INV-001",
    });
    // The evidence flows through the decision logic unchanged.
    expect(decide(evidence, "INV-001")).toBe("yes");

    // S11 (co-located): the request hit the right URL with the right auth.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://api.stripe.com/v1/payment_intents/pi_3OabcEXAMPLE",
    );
    expect(calls[0]!.auth).toBe(`Bearer ${API_KEY}`);
  });

  it("S2: succeeded + ref match + amount < expected -> evidence -> decide no (short payment)", async () => {
    const { fetch } = fakeFetch(stripeResponse(200, pi({ amount: 999 })));
    const source = makeSource(fetch);

    const evidence = await source.fetch("inv-001", "happy");
    expect(evidence).not.toBeNull();
    expect(evidence!.observedAmount).toBe("999");
    // 999 < 1000 -> short payment -> no.
    expect(decide(evidence, "INV-001")).toBe("no");
  });

  it("over-payment (amount > expected) -> decide yes", async () => {
    const { fetch } = fakeFetch(stripeResponse(200, pi({ amount: 1500 })));
    const source = makeSource(fetch);
    const evidence = await source.fetch("inv-001", "happy");
    expect(decide(evidence, "INV-001")).toBe("yes");
  });
});

// ---------------------------------------------------------------------------
// Reference binding
// ---------------------------------------------------------------------------

describe("stripeCashflowSource — reference binding", () => {
  it("S3: succeeded but no metadata.reference -> null -> no", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetch } = fakeFetch(
      stripeResponse(200, pi({ metadata: {} })),
    );
    const source = makeSource(fetch);

    const evidence = await source.fetch("inv-001", "happy");
    expect(evidence).toBeNull();
    expect(decide(evidence, "INV-001")).toBe("no");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("S3b: succeeded but metadata is null -> null -> no", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetch } = fakeFetch(
      stripeResponse(200, pi({ metadata: null })),
    );
    const source = makeSource(fetch);

    const evidence = await source.fetch("inv-001", "happy");
    expect(evidence).toBeNull();
    expect(decide(evidence, "INV-001")).toBe("no");
    errSpy.mockRestore();
  });

  it("S4: succeeded + wrong reference -> evidence with wrong ref -> decide no", async () => {
    const { fetch } = fakeFetch(
      stripeResponse(200, pi({ metadata: { reference: "WRONG-REF" } })),
    );
    const source = makeSource(fetch);

    const evidence = await source.fetch("inv-001", "happy");
    // The source returns the evidence (Stripe DID say succeeded); the reference
    // mismatch is caught by the decision logic, not the source.
    expect(evidence).not.toBeNull();
    expect(evidence!.reference).toBe("WRONG-REF");
    expect(decide(evidence, "INV-001")).toBe("no");
  });
});

// ---------------------------------------------------------------------------
// Non-succeeded statuses (conservative "no")
// ---------------------------------------------------------------------------

describe("stripeCashflowSource — non-succeeded statuses", () => {
  for (const status of ["processing", "requires_action", "requires_payment_method", "canceled", "requires_confirmation"]) {
    it(`S5: status "${status}" -> null -> no`, async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { fetch } = fakeFetch(stripeResponse(200, pi({ status })));
      const source = makeSource(fetch);

      const evidence = await source.fetch("inv-001", "happy");
      expect(evidence).toBeNull();
      expect(decide(evidence, "INV-001")).toBe("no");
      errSpy.mockRestore();
    });
  }
});

// ---------------------------------------------------------------------------
// API errors (conservative "no")
// ---------------------------------------------------------------------------

describe("stripeCashflowSource — API errors", () => {
  it("S6: 404 -> null -> no", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetch } = fakeFetch(
      stripeResponse(404, { error: { type: "invalid_request_error" } }),
    );
    const source = makeSource(fetch);

    const evidence = await source.fetch("inv-001", "happy");
    expect(evidence).toBeNull();
    expect(decide(evidence, "INV-001")).toBe("no");
    errSpy.mockRestore();
  });

  it("S7: 401 (bad key) -> null -> no", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetch } = fakeFetch(
      stripeResponse(401, { error: { type: "invalid_request_error" } }),
    );
    const source = makeSource(fetch);

    const evidence = await source.fetch("inv-001", "happy");
    expect(evidence).toBeNull();
    expect(decide(evidence, "INV-001")).toBe("no");
    errSpy.mockRestore();
  });

  it("S7b: 500 -> null -> no", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetch } = fakeFetch(stripeResponse(500, { error: {} }));
    const source = makeSource(fetch);

    const evidence = await source.fetch("inv-001", "happy");
    expect(evidence).toBeNull();
    errSpy.mockRestore();
  });

  it("S8: fetch rejects (network error) -> null -> no", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const source = makeSource(fetchImpl);

    const evidence = await source.fetch("inv-001", "happy");
    expect(evidence).toBeNull();
    expect(decide(evidence, "INV-001")).toBe("no");
    errSpy.mockRestore();
  });

  it("S8b: non-JSON body -> null -> no", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const badJson: Response = {
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
    } as Response;
    const { fetch } = fakeFetch(badJson);
    const source = makeSource(fetch);

    const evidence = await source.fetch("inv-001", "happy");
    expect(evidence).toBeNull();
    errSpy.mockRestore();
  });

  it("S8c: non-numeric amount -> null -> no", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetch } = fakeFetch(
      stripeResponse(200, { status: "succeeded", metadata: { reference: "INV-001" } }),
    );
    const source = makeSource(fetch);

    const evidence = await source.fetch("inv-001", "happy");
    expect(evidence).toBeNull();
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Index behavior
// ---------------------------------------------------------------------------

describe("stripeCashflowSource — index", () => {
  it("S9: index miss (cycle not mapped) -> null -> no (no Stripe call)", async () => {
    const fetchImpl = vi.fn(async () => stripeResponse(200, pi({}))) as unknown as typeof fetch;
    const source = makeSource(fetchImpl);

    const evidence = await source.fetch("inv-999", "unknown-cycle");
    expect(evidence).toBeNull();
    expect(decide(evidence, "INV-001")).toBe("no");
    // No fetch should have been issued for an unknown cycle.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("URL-encodes the paymentIntentId safely", async () => {
    const index: StripePaymentIndex = {
      "inv-001:happy": { paymentIntentId: "pi_3O with space", expectedAmount: "1000" },
    };
    const { fetch, calls } = fakeFetch(stripeResponse(200, pi({})));
    const source = makeSource(fetch, index);

    await source.fetch("inv-001", "happy");
    expect(calls[0]!.url).toBe(
      "https://api.stripe.com/v1/payment_intents/pi_3O%20with%20space",
    );
  });
});

// ---------------------------------------------------------------------------
// loadStripePaymentIndex — fail-fast on malformed
// ---------------------------------------------------------------------------

describe("loadStripePaymentIndex", () => {
  const tmp = (name: string, content: string): string => {
    const path = `/tmp/quittance-stripe-index-${name}-${process.pid}.json`;
    fs.writeFileSync(path, content, "utf8");
    return path;
  };

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads a valid index", () => {
    const path = tmp("valid", JSON.stringify({
      "inv-001:happy": { paymentIntentId: "pi_abc", expectedAmount: "1000" },
      "inv-001:fraud": { paymentIntentId: "pi_def", expectedAmount: "500" },
    }));
    const index = loadStripePaymentIndex(path);
    expect(Object.keys(index)).toHaveLength(2);
    expect(index["inv-001:happy"]).toEqual({ paymentIntentId: "pi_abc", expectedAmount: "1000" });
  });

  it("S10: throws on a non-object top-level (array)", () => {
    const path = tmp("array", "[]");
    expect(() => loadStripePaymentIndex(path)).toThrow(/must be a JSON object/);
  });

  it("S10b: throws on a non-object top-level (string)", () => {
    const path = tmp("string", '"hello"');
    expect(() => loadStripePaymentIndex(path)).toThrow(/must be a JSON object/);
  });

  it("throws on an entry missing paymentIntentId", () => {
    const path = tmp("no-id", JSON.stringify({ "a:b": { expectedAmount: "1000" } }));
    expect(() => loadStripePaymentIndex(path)).toThrow(/missing non-empty "paymentIntentId"/);
  });

  it("throws on an entry with empty paymentIntentId", () => {
    const path = tmp("empty-id", JSON.stringify({ "a:b": { paymentIntentId: "  ", expectedAmount: "1000" } }));
    expect(() => loadStripePaymentIndex(path)).toThrow(/missing non-empty "paymentIntentId"/);
  });

  it("throws on an entry with non-integer expectedAmount", () => {
    const path = tmp("bad-amount", JSON.stringify({ "a:b": { paymentIntentId: "pi_x", expectedAmount: "10.5" } }));
    expect(() => loadStripePaymentIndex(path)).toThrow(/non-integer-string "expectedAmount"/);
  });

  it("throws on an entry with negative expectedAmount", () => {
    const path = tmp("neg-amount", JSON.stringify({ "a:b": { paymentIntentId: "pi_x", expectedAmount: "-100" } }));
    expect(() => loadStripePaymentIndex(path)).toThrow(/non-integer-string "expectedAmount"/);
  });

  it("throws on an entry that is not an object", () => {
    const path = tmp("entry-string", JSON.stringify({ "a:b": "not-an-object" }));
    expect(() => loadStripePaymentIndex(path)).toThrow(/must be an object/);
  });

  it("throws on an unreadable file", () => {
    expect(() => loadStripePaymentIndex("/tmp/definitely-does-not-exist-quittance-12345.json")).toThrow(/could not be read/);
  });

  it("throws on invalid JSON", () => {
    const path = tmp("bad-json", "{ not valid json");
    expect(() => loadStripePaymentIndex(path)).toThrow(/not valid JSON/);
  });
});