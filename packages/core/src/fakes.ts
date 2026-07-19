import type { ChainClient, DeployResult } from "./chain-client.js";
import type { PaymentClient, PaymentRequest, SettlementReceipt } from "./payment-client.js";
import type { BriefClient, BriefInput } from "./brief-client.js";

// ---------------------------------------------------------------------------
// FakePaymentClient
// ---------------------------------------------------------------------------

export interface FakePaymentClientOptions {
  /**
   * If provided, every pay() call throws this error (after idempotency check).
   * Simulate a payment-rail failure or facilitator quota exhaustion.
   */
  forcedError?: Error;
  /**
   * amountMotes returned in generated receipts. Default: "1000000".
   */
  defaultAmountMotes?: string;
}

/**
 * In-memory PaymentClient for downstream tests (agent, e2e).
 *
 * Contracts honoured:
 * - Idempotent on (cycleId, verifierId): a second pay() for the same pair
 *   returns the cached receipt without re-settling (mirrors real x402 behaviour).
 * - Forced-error fires only for new (unsettled) pairs — a retry of an already-
 *   settled pair still returns the cached receipt even when forcedError is set.
 *
 * Introspection properties (unambiguous):
 * - `invocations` — appended on EVERY pay() call, including cache hits.
 *   Use to assert total call count (e.g. retry + idempotency tests).
 * - `settlements` — appended only on cache-miss (new) settlements.
 *   Use to assert how many unique pairs were actually paid out.
 *
 * Example: two pay() calls for the same (cycleId, verifierId) produce
 *   invocations.length === 2, settlements.length === 1.
 */
export class FakePaymentClient implements PaymentClient {
  /** Every pay() invocation, including cache hits. */
  readonly invocations: PaymentRequest[] = [];
  /** Only requests that resulted in a new settlement (cache-miss). */
  readonly settlements: SettlementReceipt[] = [];

  private readonly settled = new Map<string, SettlementReceipt>();
  private readonly forcedError: Error | undefined;
  private readonly defaultAmountMotes: string;

  constructor(options: FakePaymentClientOptions = {}) {
    this.forcedError = options.forcedError;
    this.defaultAmountMotes = options.defaultAmountMotes ?? "1000000";
  }

  async pay(req: PaymentRequest): Promise<SettlementReceipt> {
    // Record every invocation regardless of outcome.
    this.invocations.push(req);

    const key = `${req.cycleId}:${req.verifierId}`;

    // Idempotency: return cached receipt without re-settling.
    const cached = this.settled.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Simulate payment-rail failure for unsettled pairs.
    if (this.forcedError !== undefined) {
      throw this.forcedError;
    }

    const receipt: SettlementReceipt = {
      verifierId: req.verifierId,
      cycleId: req.cycleId,
      txHash: `fake-tx-${key}`,
      amountMotes: this.defaultAmountMotes,
      settledAt: new Date().toISOString(),
    };

    this.settled.set(key, receipt);
    this.settlements.push(receipt);
    return receipt;
  }

  /** Reset all recorded state and idempotency cache. Useful between test cases. */
  reset(): void {
    this.invocations.length = 0;
    this.settlements.length = 0;
    this.settled.clear();
  }
}

// ---------------------------------------------------------------------------
// FakeChainClient
// ---------------------------------------------------------------------------

export interface FakeChainClientCall {
  method: "installContract" | "callEntrypoint" | "queryDictItem" | "waitForFinality";
  args: unknown[];
}

export interface FakeChainClientOptions {
  /**
   * Prepopulated dict entries: `${contractHash}:${dict}:${key}` → value.
   * Use setDictItem() after construction to add entries dynamically.
   */
  dictItems?: Map<string, unknown>;
  /** Finality outcome returned by waitForFinality. Default: "success". */
  finality?: "success" | "failure";
  /** Seed for auto-incrementing tx hash counter. Default: 0. */
  txCounter?: number;
}

/**
 * In-memory ChainClient for downstream tests (agent, e2e).
 *
 * Contracts honoured:
 * - Records every call with method name + arguments for assertion.
 * - Returns deterministic txHashes (label-N) so tests can match on them.
 * - queryDictItem is configurable to simulate distributed flags, pool states, etc.
 *   A key not present in the dict returns undefined (not an error).
 */
export class FakeChainClient implements ChainClient {
  readonly calls: FakeChainClientCall[] = [];

  private counter: number;
  private readonly dictItems: Map<string, unknown>;
  private readonly finality: "success" | "failure";

  constructor(options: FakeChainClientOptions = {}) {
    this.counter = options.txCounter ?? 0;
    this.dictItems = options.dictItems ?? new Map<string, unknown>();
    this.finality = options.finality ?? "success";
  }

  async installContract(
    wasmPath: string,
    args: Record<string, unknown>,
  ): Promise<DeployResult> {
    this.calls.push({ method: "installContract", args: [wasmPath, args] });
    return { txHash: this.nextTxHash("install") };
  }

  async callEntrypoint(
    contractHash: string,
    entry: string,
    args: Record<string, unknown>,
  ): Promise<DeployResult> {
    this.calls.push({ method: "callEntrypoint", args: [contractHash, entry, args] });
    return { txHash: this.nextTxHash(entry) };
  }

  async queryDictItem(
    contractHash: string,
    dict: string,
    key: string,
  ): Promise<unknown> {
    this.calls.push({ method: "queryDictItem", args: [contractHash, dict, key] });
    return this.dictItems.get(`${contractHash}:${dict}:${key}`);
  }

  async waitForFinality(txHash: string): Promise<"success" | "failure"> {
    this.calls.push({ method: "waitForFinality", args: [txHash] });
    return this.finality;
  }

  /**
   * Pre-populate a dict entry so queryDictItem returns a known value.
   *
   * Example — simulate an already-distributed cycle so the agent halts:
   *   chain.setDictItem(contractHash, "distributed", "inv-1:2026-06", true);
   */
  setDictItem(
    contractHash: string,
    dict: string,
    key: string,
    value: unknown,
  ): void {
    this.dictItems.set(`${contractHash}:${dict}:${key}`, value);
  }

  /** Reset recorded calls. Dict entries and finality config are preserved. */
  reset(): void {
    this.calls.length = 0;
  }

  private nextTxHash(label: string): string {
    return `fake-tx-${label}-${++this.counter}`;
  }
}

// ---------------------------------------------------------------------------
// FakeBriefClient (SPEC-5)
// ---------------------------------------------------------------------------

/**
 * In-memory `BriefClient` for downstream tests (agent, e2e). Returns a
 * deterministic, templated verification brief from the cycle inputs — no
 * network, no LLM. The template is structured so tests can assert on the
 * cycle's verdicts + outcome without coupling to LLM prose.
 *
 * Introspection: `calls` records every `brief()` invocation (the `BriefInput`),
 * so tests can assert the LLM seam was (or was not) called (e.g. a halted
 * cycle must not call it).
 */
export class FakeBriefClient implements BriefClient {
  /** Every `brief()` invocation. */
  readonly calls: BriefInput[] = [];
  private readonly forcedError: Error | undefined;

  constructor(options: { forcedError?: Error } = {}) {
    this.forcedError = options.forcedError;
  }

  brief(input: BriefInput): Promise<string> {
    this.calls.push(input);
    if (this.forcedError) throw this.forcedError;
    return Promise.resolve(fakeBriefText(input));
  }
}

/**
 * Deterministic brief text for a cycle (the fake's narration). Structured so a
 * test can assert the verdicts + outcome were interpreted correctly.
 */
export function fakeBriefText(input: BriefInput): string {
  const yes = input.verdicts.filter((v) => v.verdict.verdict === "yes").length;
  const no = input.verdicts.filter((v) => v.verdict.verdict === "no").length;
  const outcome = input.distributed
    ? `quorum met (${yes} yes / ${no} no); the contract verified each signature on-chain and released funds pro-rata.`
    : `quorum not met (${yes} yes / ${no} no); the contract halted and released nothing.`;
  return `Cycle ${input.cycleId} on ${input.assetId}: ${outcome}`;
}
