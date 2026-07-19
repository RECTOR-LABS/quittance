import { fileCashflowSource } from "./cashflow-source.js";
import {
  loadStripePaymentIndex,
  stripeCashflowSource,
} from "./stripe-cashflow-source.js";
import { createVerifierApp } from "./server.js";
import type { VerifierPaymentConfig } from "./server.js";
import type { VerifierConfig } from "./verifier.js";
import type { CashflowSource } from "./verdict.js";

// ---------------------------------------------------------------------------
// Runnable entrypoint for a single verifier instance.
//
// All configuration — secrets, endpoints, addresses — arrives via environment
// variables (see .env.example). Missing required values fail fast with a clear
// message; no secret is ever logged.
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

function requirePort(name: string): number {
  const raw = requireEnv(name);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a TCP port in 1..65535, got: "${raw}"`);
  }
  return port;
}

/** Parse an optional positive-integer env var; undefined when unset/blank. */
function optionalPositiveInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got: "${raw}"`);
  }
  return value;
}

function buildSource(): CashflowSource {
  const kind = (process.env.VERIFIER_SOURCE ?? "file").trim();
  if (kind === "file") {
    return fileCashflowSource(requireEnv("VERIFIER_EVIDENCE_PATH"));
  }
  if (kind === "stripe") {
    // SPEC-2: one verifier reads a REAL payment rail (Stripe test mode) instead
    // of a local fixture. The index tells this source *which* PaymentIntent to
    // check; the *payment status*, *amount*, and *reference* all come from
    // Stripe. Conservative failure: any non-confirming path -> null -> "no".
    return stripeCashflowSource({
      apiKey: requireEnv("STRIPE_API_KEY"),
      paymentIndex: loadStripePaymentIndex(
        requireEnv("STRIPE_PAYMENT_INDEX_PATH"),
      ),
    });
  }
  throw new Error(
    `unknown VERIFIER_SOURCE "${kind}" (expected "file" or "stripe")`,
  );
}

function main(): void {
  const label = requireEnv("VERIFIER_LABEL");
  const port = requirePort("VERIFIER_PORT");

  const verifier: VerifierConfig = {
    source: buildSource(),
    signingKeyHex: requireEnv("VERIFIER_SIGNING_KEY_HEX"),
    label,
  };

  const maxTimeoutSeconds = optionalPositiveInt("VERIFIER_MAX_TIMEOUT_SECONDS");

  const payment: VerifierPaymentConfig = {
    facilitatorUrl: requireEnv("X402_FACILITATOR_URL"),
    facilitatorToken: requireEnv("CSPR_CLOUD_TOKEN"),
    // CASPER_NETWORK is the chain name (e.g. "casper-test"); CAIP-2 prefixes it.
    network: `casper:${requireEnv("CASPER_NETWORK")}`,
    asset: requireEnv("WCSPR_PACKAGE_HASH"),
    payTo: requireEnv("VERIFIER_PAYTO"),
    priceMotes: requireEnv("VERIFIER_PRICE_MOTES"),
    // The WCSPR EIP-712 domain. Overridable for other payment tokens, but the
    // defaults MUST match WCSPR or settlement fails `invalid_signature`.
    tokenName: process.env.WCSPR_TOKEN_NAME?.trim() || "Wrapped CSPR",
    tokenVersion: process.env.WCSPR_TOKEN_VERSION?.trim() || "1",
    expectedReference: requireEnv("VERIFIER_EXPECTED_REFERENCE"),
    // Optional; server.ts applies DEFAULT_MAX_TIMEOUT_SECONDS when omitted.
    ...(maxTimeoutSeconds !== undefined ? { maxTimeoutSeconds } : {}),
  };

  const app = createVerifierApp({ verifier, payment });
  const server = app.listen(port, () => {
    // No secrets: only non-sensitive operational facts.
    console.log(
      `[verifier:${label}] listening on :${port} ` +
        `(network=${payment.network}, route=GET /verify)`,
    );
  });
  // listen() reports bind failures (e.g. EADDRINUSE) asynchronously, after the
  // sync try/catch below has returned — surface them with the same curated
  // message and a non-zero exit.
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`[verifier] failed to start: ${err.message}`);
    process.exit(1);
  });
}

try {
  main();
} catch (err) {
  console.error(
    `[verifier] failed to start: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
