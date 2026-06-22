/**
 * Pure decision logic for a Quittance verifier.
 *
 * No I/O, no signing — just the rules that determine whether a real-world
 * cashflow cycle qualifies as verified. All amount comparisons use BigInt
 * because values are integer strings in the smallest unit (e.g. motes).
 */

export interface CashflowEvidence {
  assetId: string;
  cycleId: string;
  expectedAmount: string; // integer string (smallest unit)
  observedAmount: string; // integer string; "0" if nothing observed
  reference: string;      // e.g. invoice/payment reference that must match
}

export interface CashflowSource {
  /** Returns evidence for a cycle, or null if the source has no record. */
  fetch(assetId: string, cycleId: string): Promise<CashflowEvidence | null>;
}

/**
 * Pure: decide the verdict from evidence.
 *
 * Rules (applied in order):
 * 1. null evidence → "no"
 * 2. reference mismatch (evidence.reference !== expectedReference) → "no"
 * 3. BigInt(observedAmount) >= BigInt(expectedAmount) → "yes"; else "no"
 */
export function decide(
  evidence: CashflowEvidence | null,
  expectedReference: string,
): "yes" | "no" {
  if (evidence === null) {
    return "no";
  }

  if (evidence.reference !== expectedReference) {
    return "no";
  }

  if (BigInt(evidence.observedAmount) >= BigInt(evidence.expectedAmount)) {
    return "yes";
  }

  return "no";
}
