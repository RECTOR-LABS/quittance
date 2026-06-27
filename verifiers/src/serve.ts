import { fileCashflowSource } from "./cashflow-source.js";
import { createVerifierApp } from "./server.js";
import type { VerifierPaymentConfig } from "./server.js";
import type { VerifierConfig } from "./verifier.js";

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

function main(): void {
  const label = requireEnv("VERIFIER_LABEL");
  const port = requirePort("VERIFIER_PORT");

  const verifier: VerifierConfig = {
    source: fileCashflowSource(requireEnv("VERIFIER_EVIDENCE_PATH")),
    signingKeyHex: requireEnv("VERIFIER_SIGNING_KEY_HEX"),
    label,
  };

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
  };

  const app = createVerifierApp({ verifier, payment });
  app.listen(port, () => {
    // No secrets: only non-sensitive operational facts.
    console.log(
      `[verifier:${label}] listening on :${port} ` +
        `(network=${payment.network}, route=GET /verify)`,
    );
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
