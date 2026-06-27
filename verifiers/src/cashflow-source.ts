import { readFileSync } from "node:fs";
import type { CashflowEvidence, CashflowSource } from "./verdict.js";

/**
 * A {@link CashflowSource} backed by a JSON fixture file that maps
 * `"<assetId>:<cycleId>"` keys to {@link CashflowEvidence} records.
 *
 * The file is read and parsed once, at construction, so a missing or malformed
 * fixture fails fast at startup rather than on the first request. Unknown keys
 * resolve to `null`, which the decision logic treats as a "no" verdict.
 *
 * The fixture *content* (the actual evidence rows) is supplied per verifier
 * instance by a later task; this loader only owns the lookup contract.
 */
export function fileCashflowSource(path: string): CashflowSource {
  const table = loadFixture(path);
  return {
    fetch: async (assetId: string, cycleId: string) => {
      const evidence = table[evidenceKey(assetId, cycleId)];
      return evidence ?? null;
    },
  };
}

function evidenceKey(assetId: string, cycleId: string): string {
  return `${assetId}:${cycleId}`;
}

function loadFixture(path: string): Record<string, CashflowEvidence> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`cashflow evidence fixture could not be read at "${path}"`, {
      cause,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `cashflow evidence fixture at "${path}" is not valid JSON`,
      { cause },
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `cashflow evidence fixture at "${path}" must be a JSON object ` +
        `mapping "<assetId>:<cycleId>" to evidence`,
    );
  }

  return parsed as Record<string, CashflowEvidence>;
}
