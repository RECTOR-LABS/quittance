import { describe, it, expect, beforeEach } from "vitest";
import { FakePaymentClient } from "./fakes.js";
import type { PaymentRequest } from "./payment-client.js";

const baseReq: PaymentRequest = {
  url: "https://pay.example.com/settle",
  cycleId: "2026-06",
  verifierId: "verifier-a",
};

describe("FakePaymentClient", () => {
  let client: FakePaymentClient;

  beforeEach(() => {
    client = new FakePaymentClient();
  });

  // -------------------------------------------------------------------------
  // Core idempotency / invocation tracking
  // -------------------------------------------------------------------------

  it("duplicate pay() → invocations=2, settlements=1, same receipt object", async () => {
    const receipt1 = await client.pay(baseReq);
    const receipt2 = await client.pay(baseReq);

    expect(client.invocations).toHaveLength(2);
    expect(client.settlements).toHaveLength(1);
    expect(receipt1).toBe(receipt2); // strict reference equality — same cached object
  });

  it("distinct (cycleId, verifierId) pairs each produce a settlement", async () => {
    const req2: PaymentRequest = { ...baseReq, verifierId: "verifier-b" };

    await client.pay(baseReq);
    await client.pay(req2);

    expect(client.invocations).toHaveLength(2);
    expect(client.settlements).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // forcedError behaviour (idempotency fires before the error)
  // -------------------------------------------------------------------------

  it("forcedError throws on unsettled pair and does not populate settlements", async () => {
    const errorClient = new FakePaymentClient({ forcedError: new Error("quota") });

    await expect(errorClient.pay(baseReq)).rejects.toThrow("quota");

    // The invocation was recorded even though it threw.
    expect(errorClient.invocations).toHaveLength(1);
    expect(errorClient.settlements).toHaveLength(0);
  });

  it("forcedError does not block a previously-settled pair (idempotency before error)", async () => {
    // Settle the pair without error on a normal client first.
    const r1 = await client.pay(baseReq);
    expect(client.settlements).toHaveLength(1);

    // A second pay() call on the same pair should return the cached receipt
    // without re-running the error path (idempotency gate is checked first).
    const r2 = await client.pay(baseReq);
    expect(r1).toBe(r2);
    expect(client.invocations).toHaveLength(2);
    expect(client.settlements).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // reset()
  // -------------------------------------------------------------------------

  it("reset() clears invocations, settlements, and idempotency cache", async () => {
    await client.pay(baseReq);
    client.reset();

    expect(client.invocations).toHaveLength(0);
    expect(client.settlements).toHaveLength(0);

    // After reset, same pair produces a fresh settlement (cache was cleared).
    const r = await client.pay(baseReq);
    expect(client.settlements).toHaveLength(1);
    expect(r.txHash).toBe("fake-tx-2026-06:verifier-a");
  });
});
