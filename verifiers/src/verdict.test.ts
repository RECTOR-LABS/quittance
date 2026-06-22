import { describe, it, expect } from "vitest";
import { decide } from "./verdict.js";
import type { CashflowEvidence } from "./verdict.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE: CashflowEvidence = {
  assetId: "inv-001",
  cycleId: "2026-06",
  expectedAmount: "10000000000",
  observedAmount: "10000000000",
  reference: "REF-ABC-001",
};

const EXPECTED_REF = "REF-ABC-001";

// ---------------------------------------------------------------------------
// decide()
// ---------------------------------------------------------------------------

describe("decide", () => {
  it("exact-match payment returns yes", () => {
    expect(decide(BASE, EXPECTED_REF)).toBe("yes");
  });

  it("over-payment (observed > expected) returns yes", () => {
    const evidence: CashflowEvidence = {
      ...BASE,
      observedAmount: "10000000001",
    };
    expect(decide(evidence, EXPECTED_REF)).toBe("yes");
  });

  it("short payment (observed < expected) returns no", () => {
    const evidence: CashflowEvidence = {
      ...BASE,
      observedAmount: "9999999999",
    };
    expect(decide(evidence, EXPECTED_REF)).toBe("no");
  });

  it("null evidence returns no", () => {
    expect(decide(null, EXPECTED_REF)).toBe("no");
  });

  it("mismatched reference returns no even if amount is sufficient", () => {
    const evidence: CashflowEvidence = {
      ...BASE,
      reference: "WRONG-REF-999",
    };
    expect(decide(evidence, EXPECTED_REF)).toBe("no");
  });

  it("zero observed amount with non-zero expected returns no", () => {
    const evidence: CashflowEvidence = {
      ...BASE,
      observedAmount: "0",
    };
    expect(decide(evidence, EXPECTED_REF)).toBe("no");
  });

  it("both amounts zero and reference matches returns yes", () => {
    const evidence: CashflowEvidence = {
      ...BASE,
      expectedAmount: "0",
      observedAmount: "0",
    };
    expect(decide(evidence, EXPECTED_REF)).toBe("yes");
  });
});
