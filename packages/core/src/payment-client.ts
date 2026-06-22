export interface PaymentRequest {
  url: string;
  cycleId: string;
  verifierId: string;
}

export interface SettlementReceipt {
  verifierId: string;
  cycleId: string;
  txHash: string;
  amountMotes: string;
  settledAt: string; // ISO 8601
}

export interface PaymentClient {
  /** Pays an x402-gated URL; MUST be idempotent on (cycleId, verifierId). */
  pay(req: PaymentRequest): Promise<SettlementReceipt>;
}
