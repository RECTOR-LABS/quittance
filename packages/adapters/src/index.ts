// Casper x402 VerifierClient — pays an x402-gated verifier and returns its
// settlement receipt + signed verdict in one call.
export { CasperVerifierClient } from "./casper-verifier-client.js";
export type {
  CasperVerifierClientConfig,
  CasperVerifierClientDeps,
} from "./casper-verifier-client.js";

// Casper ChainClient — the casper-js-sdk v5 on-chain interface the agent uses
// to install + drive the ServicerVault contract (entrypoint calls, dict reads,
// finality), converting the agent's hex args to the contract's CLValues.
export { CasperJsChainClient } from "./casper-js-chain-client.js";
export type {
  CasperJsChainClientConfig,
  CasperJsChainClientDeps,
  CasperJsChainClientKey,
} from "./casper-js-chain-client.js";
