// Types
export type { Hash, PublicKeyHex, SignedVerdict, Verdict } from "./types.js";

// PaymentClient interface
export type { PaymentClient, PaymentRequest, SettlementReceipt } from "./payment-client.js";

// ChainClient interface
export type { ChainClient, DeployResult } from "./chain-client.js";

// BriefClient interface (SPEC-5 — agentic verification brief seam)
export type { BriefClient, BriefInput, BriefReputationSnapshot } from "./brief-client.js";

// Signing / verification trust primitive
export { canonicalBytes, canonicalHash, signVerdict, verifyVerdict } from "./sign.js";

// Quorum logic
export type { QuorumResult } from "./quorum.js";
export { reachQuorum } from "./quorum.js";

// Fakes (for downstream package tests — no real SDK dependencies)
export type {
  FakeChainClientCall,
  FakeChainClientOptions,
  FakePaymentClientOptions,
} from "./fakes.js";
export { FakeChainClient, FakePaymentClient, FakeBriefClient, fakeBriefText } from "./fakes.js";
