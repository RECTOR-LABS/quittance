import { readFileSync } from "node:fs";
import type { CashflowEvidence, CashflowSource } from "./verdict.js";

// ---------------------------------------------------------------------------
// A {@link CashflowSource} backed by the real Stripe test-mode API.
//
// One verifier in the Quittance demo reads a real payment rail (Stripe test
// mode) instead of a local JSON fixture. The payment *index* (config) tells
// this source *which* PaymentIntent to check; the *payment status*, *amount*,
// and *reference* all come from Stripe. A fixture can lie; a `succeeded`
// PaymentIntent in Stripe test mode is real settlement-rail state.
//
// Conservative failure: every non-confirming path returns `null` (the decision
// logic then votes "no"). A payment verifier must NEVER report "yes" when it
// cannot confirm payment — false-positive (release funds without payment) is
// impossible by construction; false-negatives (transient Stripe outage) are
// safe (quorum fails -> halt -> funds withheld).
//
// Injectable `fetchImpl` (default global `fetch`) so the source is unit-testable
// without hitting Stripe. No `stripe` npm dependency — the built-in `fetch`
// + a single GET to `/v1/payment_intents/{id}` is sufficient.
// ---------------------------------------------------------------------------

/** A single entry in the payment index: which PI to check + expected amount. */
export interface StripePaymentIndexEntry {
  /** Test-mode PaymentIntent id (`pi_...`). */
  paymentIntentId: string;
  /** Expected amount, integer string, in the PI's smallest unit (e.g. cents). */
  expectedAmount: string;
}

/** Payment index: `"<assetId>:<cycleId>"` → entry. */
export type StripePaymentIndex = Record<string, StripePaymentIndexEntry>;

export interface StripeSourceConfig {
  /** Stripe test-mode secret key (`sk_test_...`). Never `sk_live_...`. */
  apiKey: string;
  /** Loaded payment index (use {@link loadStripePaymentIndex} to build from a file). */
  paymentIndex: StripePaymentIndex;
  /**
   * Injectable fetch (default global `fetch`). Tests pass a fake that returns
   * canned `Response` objects; the source never touches the network in tests.
   */
  fetchImpl?: typeof fetch;
}

/** Stripe API base. Overridable for tests (e.g. pointing at a mock server). */
const STRIPE_API_BASE = "https://api.stripe.com";

/**
 * Build a {@link CashflowSource} that confirms a Stripe test-mode
 * PaymentIntent `succeeded` with the expected amount + reference.
 */
export function stripeCashflowSource(cfg: StripeSourceConfig): CashflowSource {
  const fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
  return {
    fetch: async (assetId, cycleId) => {
      const entry = cfg.paymentIndex[`${assetId}:${cycleId}`];
      if (entry === undefined) {
        // Index miss: unknown cycle -> no claim -> "no".
        return null;
      }

      const url = `${STRIPE_API_BASE}/v1/payment_intents/${encodeURIComponent(entry.paymentIntentId)}`;
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
        });
      } catch (err) {
        // Network/transport failure: conservative "no" (safe: funds withheld).
        // Non-leaky log: no secret, only the actionable failure class.
        console.error(
          `[verifier:stripe] fetch failed for ${entry.paymentIntentId}:`,
          err instanceof Error ? err.message : String(err),
        );
        return null;
      }

      if (!res.ok) {
        // Non-2xx: 401 (bad key), 404 (wrong PI id), 5xx, etc. -> conservative "no".
        console.error(
          `[verifier:stripe] Stripe returned ${res.status} for ${entry.paymentIntentId}`,
        );
        return null;
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (err) {
        console.error(
          `[verifier:stripe] could not parse Stripe response for ${entry.paymentIntentId}:`,
          err instanceof Error ? err.message : String(err),
        );
        return null;
      }

      const pi = body as {
        status?: string;
        amount?: number;
        metadata?: Record<string, string> | null;
      };

      if (pi.status !== "succeeded") {
        // processing / requires_action / canceled / requires_payment_method, etc.
        console.error(
          `[verifier:stripe] ${entry.paymentIntentId} status is "${pi.status ?? "<missing>"}" (not "succeeded")`,
        );
        return null;
      }

      const reference = pi.metadata?.reference ?? null;
      if (reference === null) {
        // The PI doesn't carry the invoice tag -> can't bind to the expected cashflow.
        console.error(
          `[verifier:stripe] ${entry.paymentIntentId} has no metadata.reference`,
        );
        return null;
      }

      if (typeof pi.amount !== "number" || !Number.isFinite(pi.amount)) {
        console.error(
          `[verifier:stripe] ${entry.paymentIntentId} has non-numeric amount`,
        );
        return null;
      }

      const evidence: CashflowEvidence = {
        assetId,
        cycleId,
        expectedAmount: entry.expectedAmount,
        observedAmount: String(pi.amount),
        reference,
      };
      return evidence;
    },
  };
}

/**
 * Load + validate a Stripe payment index from a JSON file. Fails fast at
 * server startup on a malformed index (mirrors {@link fileCashflowSource}'s
 * `loadFixture` discipline).
 */
export function loadStripePaymentIndex(path: string): StripePaymentIndex {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`stripe payment index could not be read at "${path}"`, {
      cause,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`stripe payment index at "${path}" is not valid JSON`, {
      cause,
    });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `stripe payment index at "${path}" must be a JSON object ` +
        `mapping "<assetId>:<cycleId>" to { paymentIntentId, expectedAmount }`,
    );
  }

  const table = parsed as Record<string, unknown>;
  const index: StripePaymentIndex = {};
  for (const [key, value] of Object.entries(table)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(
        `stripe payment index at "${path}" entry "${key}" must be an object`,
      );
    }
    const entry = value as { paymentIntentId?: unknown; expectedAmount?: unknown };
    if (
      typeof entry.paymentIntentId !== "string" ||
      entry.paymentIntentId.trim() === ""
    ) {
      throw new Error(
        `stripe payment index at "${path}" entry "${key}" missing non-empty "paymentIntentId"`,
      );
    }
    if (
      typeof entry.expectedAmount !== "string" ||
      !/^\d+$/.test(entry.expectedAmount)
    ) {
      throw new Error(
        `stripe payment index at "${path}" entry "${key}" has non-integer-string "expectedAmount"`,
      );
    }
    index[key] = {
      paymentIntentId: entry.paymentIntentId.trim(),
      expectedAmount: entry.expectedAmount,
    };
  }
  return index;
}