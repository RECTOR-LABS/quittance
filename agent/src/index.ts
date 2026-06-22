// VerifierClient seam + types (FakeVerifierClient is test-only — import directly from ./verifier-client)
export type {
  VerifierEndpoint,
  VerifierResponse,
  VerifierClient,
  FakeEndpointConfig,
  FakeVerifierClientOptions,
} from "./verifier-client.js";

// Servicer state machine
export type {
  AssetServicingConfig,
  ServicerDeps,
  HaltReason,
  CycleOutcome,
} from "./servicer.js";
export { runCycle } from "./servicer.js";
