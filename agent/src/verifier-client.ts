import type { SettlementReceipt, SignedVerdict } from "@quittance/core";
import type { VerifyQuery } from "@quittance/verifier";

// ---------------------------------------------------------------------------
// VerifierClient seam — "pay + get verdict" as one logical operation.
// Real implementation (x402 HTTP call via PaymentClient + fetch) is deferred
// to a creds-gated task. Tests use FakeVerifierClient below.
// ---------------------------------------------------------------------------

export interface VerifierEndpoint {
  id: string;
  url: string;
}

export interface VerifierResponse {
  receipt: SettlementReceipt;
  verdict: SignedVerdict;
}

export interface VerifierClient {
  /** Pay the x402-gated verifier and return its settlement receipt + signed verdict. */
  query(endpoint: VerifierEndpoint, q: VerifyQuery): Promise<VerifierResponse>;
}

// ---------------------------------------------------------------------------
// FakeVerifierClient — configurable per-endpoint; records invocations.
// ---------------------------------------------------------------------------

export type FakeEndpointConfig =
  | { kind: "response"; value: VerifierResponse }
  | { kind: "error"; error: Error };

export interface FakeVerifierClientOptions {
  /**
   * Per-endpoint config keyed by VerifierEndpoint.id.
   * If an endpoint id has no entry the call throws by default.
   */
  endpoints?: Map<string, FakeEndpointConfig>;
  /**
   * Fallback config for any endpoint not found in the map.
   * If not set, unknown endpoints throw an "unconfigured endpoint" error.
   */
  fallback?: FakeEndpointConfig;
}

export class FakeVerifierClient implements VerifierClient {
  /** Every query() call in order. Includes calls that threw. */
  readonly invocations: Array<{ endpoint: VerifierEndpoint; query: VerifyQuery }> = [];

  private readonly endpoints: Map<string, FakeEndpointConfig>;
  private readonly fallback: FakeEndpointConfig | undefined;

  constructor(options: FakeVerifierClientOptions = {}) {
    this.endpoints = options.endpoints ?? new Map();
    this.fallback = options.fallback;
  }

  async query(endpoint: VerifierEndpoint, q: VerifyQuery): Promise<VerifierResponse> {
    this.invocations.push({ endpoint, query: q });

    const cfg = this.endpoints.get(endpoint.id) ?? this.fallback;
    if (cfg === undefined) {
      throw new Error(`FakeVerifierClient: no config for endpoint "${endpoint.id}"`);
    }

    if (cfg.kind === "error") {
      throw cfg.error;
    }

    return cfg.value;
  }

  /** Reset recorded invocations. Endpoint configs are preserved. */
  reset(): void {
    this.invocations.length = 0;
  }
}
