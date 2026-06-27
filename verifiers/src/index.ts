// Decision logic
export type { CashflowEvidence, CashflowSource } from "./verdict.js";
export { decide } from "./verdict.js";

// Compose + sign
export type { VerifierConfig, VerifyQuery } from "./verifier.js";
export { runVerifier } from "./verifier.js";

// Evidence source (JSON-fixture backed)
export { fileCashflowSource } from "./cashflow-source.js";

// x402-gated HTTP verifier service
export type {
  CreateVerifierAppOptions,
  VerifierPaymentConfig,
} from "./server.js";
export { createVerifierApp } from "./server.js";
