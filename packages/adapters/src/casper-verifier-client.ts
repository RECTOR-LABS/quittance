import { verifyVerdict } from "@quittance/core";
import type { SettlementReceipt, SignedVerdict } from "@quittance/core";
import type { VerifierClient, VerifierEndpoint, VerifierResponse } from "@quittance/agent";
import type { VerifyQuery } from "@quittance/verifier";
import { x402Client, x402HTTPClient, wrapFetchWithPayment } from "@x402/fetch";
import type { PaymentRequirements } from "@x402/fetch";
import {
  ExactCasperScheme,
  createClientCasperSigner,
} from "@make-software/casper-x402";
import type { ClientCasperSigner } from "@make-software/casper-x402";
import casperSdk from "casper-js-sdk";
import type { KeyAlgorithm } from "casper-js-sdk";

// ---------------------------------------------------------------------------
// CasperVerifierClient — the real VerifierClient: pay an x402-gated verifier and
// receive its signed verdict in ONE call.
//
// Why VerifierClient (not a standalone PaymentClient): casper-x402's
// `wrapFetchWithPayment` couples payment to the HTTP fetch — a single paid GET
// returns the verifier's verdict (body) AND the settlement (PAYMENT-RESPONSE
// header) together. Splitting them would pay and throw the verdict away.
//
// The 402 -> sign -> retry mechanics are entirely casper-x402's responsibility
// (handled inside `paidFetch`). This adapter owns four things, all unit-tested
// against a mocked fetch: URL construction, body validation, signature trust
// (verifyVerdict), and the SettleResponse -> SettlementReceipt field mapping.
// Live on-chain settlement is covered by the RUN_TESTNET-gated integration test.
// ---------------------------------------------------------------------------

/**
 * Either a pre-built signer, or a PEM path the client loads itself via
 * `createClientCasperSigner`.
 */
export type CasperVerifierClientConfig =
  | { signer: ClientCasperSigner }
  | { secretKeyPath: string; keyAlgo?: KeyAlgorithm };

export interface CasperVerifierClientDeps {
  /**
   * The underlying fetch wrapped with x402 payment. Injectable for tests; do
   * NOT monkey-patch globals. Defaults to the runtime `fetch`.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Picks the payment requirement to satisfy: the first Casper option, falling
 * back to the first option of any chain. casper-x402 calls this when a 402 is hit.
 */
function selectCasperRequirement(
  _x402Version: number,
  options: PaymentRequirements[],
): PaymentRequirements {
  const casper = options.find((o) => o.network?.startsWith("casper:"));
  const chosen = casper ?? options[0];
  if (chosen === undefined) {
    throw new Error("x402 402 response carried no payment requirements to satisfy");
  }
  return chosen;
}

/**
 * Narrows arbitrary parsed JSON to a structurally-valid SignedVerdict.
 * Does NOT check the signature — that is `verifyVerdict`'s job.
 */
function isSignedVerdict(value: unknown): value is SignedVerdict {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v["signature"] !== "string" || typeof v["signer"] !== "string") return false;
  const inner = v["verdict"];
  if (typeof inner !== "object" || inner === null) return false;
  const vv = inner as Record<string, unknown>;
  return (
    typeof vv["assetId"] === "string" &&
    typeof vv["cycleId"] === "string" &&
    (vv["verdict"] === "yes" || vv["verdict"] === "no") &&
    typeof vv["observedAmount"] === "string" &&
    typeof vv["source"] === "string"
  );
}

export class CasperVerifierClient implements VerifierClient {
  private readonly httpClient: x402HTTPClient;
  private readonly paidFetchPromise: Promise<typeof fetch>;

  constructor(config: CasperVerifierClientConfig, deps: CasperVerifierClientDeps = {}) {
    const baseFetch = deps.fetchImpl ?? fetch;
    const client = new x402Client(selectCasperRequirement);
    this.httpClient = new x402HTTPClient(client);

    // Resolve the signer (possibly async if loaded from PEM), register the
    // Casper Exact scheme, then build the paid fetch once. Stored as a promise
    // so the async PEM path doesn't force an async constructor.
    this.paidFetchPromise = this.resolveSigner(config).then((signer) => {
      client.register("casper:*", new ExactCasperScheme(signer));
      return wrapFetchWithPayment(baseFetch, client);
    });
  }

  private async resolveSigner(config: CasperVerifierClientConfig): Promise<ClientCasperSigner> {
    if ("signer" in config) return config.signer;
    const algo = config.keyAlgo ?? casperSdk.KeyAlgorithm.ED25519;
    return createClientCasperSigner(config.secretKeyPath, algo);
  }

  async query(endpoint: VerifierEndpoint, q: VerifyQuery): Promise<VerifierResponse> {
    const paidFetch = await this.paidFetchPromise;

    const url =
      `${endpoint.url}?asset=${encodeURIComponent(q.assetId)}` +
      `&cycle=${encodeURIComponent(q.cycleId)}`;

    // casper-x402 transparently handles 402 -> sign -> retry inside paidFetch.
    const res = await paidFetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`verifier ${endpoint.id} returned ${res.status} (${res.statusText})`);
    }

    const verdict = await this.parseVerdict(res, endpoint, q);
    const receipt = this.extractReceipt(res, endpoint, q);
    return { receipt, verdict };
  }

  /** Parse + structurally validate + signature-verify the verifier's verdict. */
  private async parseVerdict(
    res: Response,
    endpoint: VerifierEndpoint,
    q: VerifyQuery,
  ): Promise<SignedVerdict> {
    let body: unknown;
    try {
      body = await res.json();
    } catch (cause) {
      throw new Error(`verifier ${endpoint.id} returned a non-JSON body`, { cause });
    }

    if (!isSignedVerdict(body)) {
      throw new Error(
        `verifier ${endpoint.id} returned a malformed body (not a SignedVerdict)`,
      );
    }

    if (body.verdict.assetId !== q.assetId || body.verdict.cycleId !== q.cycleId) {
      throw new Error(
        `verifier ${endpoint.id} returned a verdict for ` +
          `asset=${body.verdict.assetId} cycle=${body.verdict.cycleId}, ` +
          `expected asset=${q.assetId} cycle=${q.cycleId} (mismatch)`,
      );
    }

    // A verifier that returns a bad signature is a hard error — never trust it.
    if (!verifyVerdict(body)) {
      throw new Error(
        `verifier ${endpoint.id} returned a verdict with an invalid signature`,
      );
    }

    return body;
  }

  /** Map casper-x402's SettleResponse (PAYMENT-RESPONSE header) -> SettlementReceipt. */
  private extractReceipt(
    res: Response,
    endpoint: VerifierEndpoint,
    q: VerifyQuery,
  ): SettlementReceipt {
    // Throws "Payment response header not found" if PAYMENT-RESPONSE is absent.
    const settle = this.httpClient.getPaymentSettleResponse((name) => res.headers.get(name));

    if (!settle.success) {
      const reason = settle.errorReason ?? settle.errorMessage ?? "unknown";
      throw new Error(`verifier ${endpoint.id} settlement failed: ${reason}`);
    }
    if (!settle.transaction) {
      throw new Error(
        `verifier ${endpoint.id} settled without a transaction hash`,
      );
    }

    return {
      verifierId: endpoint.id,
      cycleId: q.cycleId,
      txHash: settle.transaction,
      // `amount` on SettleResponse is only populated by variable-amount schemes
      // (e.g. `upto`). The Casper *exact* scheme's settle() returns no `amount`
      // (verified against casper-x402 source) because it settles exactly the
      // verifier's declared price — which the scheme enforces equals the agent's
      // `expectedAmount` (authorization.value === requirements.amount). So we
      // surface the facilitator's reported amount when present, otherwise the
      // expected (and thus settled) amount. Never a misleading "0".
      amountMotes: settle.amount ?? q.expectedAmount,
      // SettleResponse carries no timestamp — stamp at receive time (ISO 8601).
      settledAt: new Date().toISOString(),
    };
  }
}
