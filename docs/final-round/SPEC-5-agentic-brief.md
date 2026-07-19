# SPEC-5 — Agentic Verification Brief (the AI reasons, the chain decides)

> **Workstream 4 of the Final-Round campaign** (see `PRD.md` §9). Closes the "Use of AI / Agentic Systems" rubric gap (currently 🔴 → 🟢 target) and gives Quittance parity with Concordia's agentic story — but load-bearing honestly (our AI explains a cryptographically verified record, not an attested one).
> **Status:** Draft for RECTOR's sign-off. **No implementation until approved.**
> **Depends on:** SPEC-1 (extends its `Receipt`-adjacent storage) + SPEC-4 (the brief narrates the cryptographically verified quorum) + SPEC-6 (the brief references the reputation snapshot). **Day-0 spike: none needed** — uses only Odra APIs already proven by SPEC-1/4/6 (`Mapping`, `String` CLValue).

---

## 1. Goal

After a cycle settles, the agent produces a **per-cycle verification brief** — a short, human-readable AI explanation of *what the verifiers said, what the chain verified, and why funds moved (or didn't)* — and records it on-chain alongside the receipt. A judge can read the brief from the contract and see the agent's reasoning over the cryptographically verified record.

**North-Star link (PRD G3):** close soft spot **S-ai** ("the AI just narrates — where's the agentic integration?"). The AI becomes **load-bearing for explanation**, not for decision. **Determinism stays absolute:** the LLM never decides fund release (PRD non-goal); the quorum gate stays signature-based (SPEC-4). The brief is the agent's *interpretation* of facts the chain already established — the "agentic" layer that makes the record legible to a non-technical judge.

---

## 2. Scope

**In:**
- A new `briefs: Mapping<String, String>` storage keyed `"{asset_id}:{cycle_id}"` (same convention as `receipts`/`distributed`).
- A new **servicer-key-gated, idempotent** `record_brief(asset_id, cycle_id, brief: String)` entrypoint — one brief per settled cycle, no overwrite.
- A read entrypoint `get_brief(asset_id, cycle_id) -> Option<String>`.
- An agent **`BriefClient` seam** (interface + fake for tests; real impl via `ANTHROPIC_API_KEY` or `OLLAMA_HOST` per AGENTS.md) that produces the brief from the cycle's verdicts + outcome + reputation snapshot.
- The agent's `runCycle` calls the LLM after a successful distribute, then calls `record_brief`.
- Dashboard: render the brief on the receipt card (the AI's explanation of the cycle).
- Tests (contract: storage/read/idempotency/gate/no-overwrite; agent: LLM-mocked → brief → record_brief call; dashboard: render + fallback).

**Out (deferred / fenced):**
- **LLM-driven distribution decisions** — the quorum stays deterministic; the AI reasons, never decides (PRD non-goal, absolute).
- **IPFS / off-chain brief storage** — the demo stores the brief on-chain as a `String` (see §3); IPFS hash-pointer is the documented production design (PRD Q6).
- **Brief for halted cycles** — a halted cycle reverts `distribute()` (no settlement, no receipt); SPEC-5 records a brief only for **settled** cycles (parity with SPEC-1's "no phantom receipts"). The agent *may* narrate a halt off-chain for the demo log, but it is not recorded on-chain (no settlement to anchor it to).
- **Brief verification / signature** — the brief is agent-attested narration, NOT cryptographically verified (see §7). The cryptographic truth is the on-chain signatures + reputation (SPEC-4/6).

---

## 3. Key design decision — brief storage: on-chain String (demo) vs IPFS hash (production)

**PRD Q6 leaned IPFS hash** ("keeps chain lean"). For the **demo**, I recommend **on-chain `String`** instead:

| | On-chain `String` (recommended for demo) | IPFS hash pointer (production) |
|---|---|---|
| Judge reads it | directly from the contract (`get_brief`) — no infra | needs an IPFS gateway (pinning, "pin expired" risk during judging) |
| Self-contained | yes (no external dependency) | no (IPFS node/pinning service) |
| Cost | a few hundred bytes of LLM narration per cycle — trivial for a 3-verifier demo | a 32-byte hash |
| Failure mode | none (it's in contract state) | gateway down / pin expired → brief unreadable |

The brief is small (a few hundred bytes — a paragraph of LLM narration). On-chain `String` is **self-contained and judge-readable without infra** — exactly what a hackathon demo needs. The chain-lean argument matters at production scale (thousands of cycles), not for a 3-cycle demo. **IPFS hash-pointer is documented as the production design** (keeps chain lean at scale; the brief content lives off-chain, only its hash on-chain). This is a real decision — flagging for RECTOR's sign-off.

---

## 4. Trust boundary — the AI reasons, the chain decides (this is the whole point)

| | |
|---|---|
| Who decides fund release | **the contract** (SPEC-4 signature gate) — unchanged |
| Who writes the brief | **the agent** (servicer key) — post-hoc narration of a distribute that already happened |
| Is the brief cryptographically verified | **no** — it's the LLM's interpretation (agent-attested) |
| Can a compromised agent misuse the brief | only to **mislead the dashboard reader** — it cannot move funds (the gate is cryptographic) and the on-chain signatures + reputation (SPEC-4/6) remain the verifiable truth |
| Can the brief overwrite a receipt | **no** — idempotent per `(asset_id, cycle_id)`; first brief is final |

The brief is the **explanation layer**, not the **trust layer**. A judge who distrusts the brief can ignore it and read the raw signatures + reputation — the brief is a legibility aid, not a proof. This is the honest framing: "the AI makes the cryptographically verified record legible; it does not establish the record."

---

## 5. Data model + contract changes

### 5.1 Storage (additive — alongside `receipts`)
```rust
/// `"{asset_id}:{cycle_id}" -> String` once a brief is recorded (SPEC-5).
/// Same colon-joined key as `receipts`/`distributed`. The agent's per-cycle
/// AI verification brief — a human-readable explanation of the cryptographically
/// verified record. Written by `record_brief` (servicer-key-gated, idempotent)
/// after a successful distribute. Read via [`Self::get_brief`].
briefs: Mapping<String, String>,
```

### 5.2 New error
```rust
/// `record_brief` called for a `(asset_id, cycle_id)` that already has a brief.
BriefAlreadyRecorded = 10,
/// `record_brief` called for a cycle that has NOT been distributed (no receipt
/// to anchor the brief to).
CycleNotSettled = 11,
```

### 5.3 `record_brief` entrypoint (servicer-key-gated, idempotent)
```rust
/// Record the agent's per-cycle AI verification brief (SPEC-5). Servicer-key-
/// gated (operational — only the agent may write narration), idempotent per
/// `(asset_id, cycle_id)` (first brief is final; `BriefAlreadyRecorded` on
/// re-write), and only allowed for a cycle that has already settled
/// (`CycleNotSettled` if no receipt exists). The brief is agent-attested
/// narration, NOT cryptographically verified — the verifiable truth is the
/// on-chain signatures + reputation (SPEC-4/6).
pub fn record_brief(&mut self, asset_id: String, cycle_id: String, brief: String) {
    // (operational gate) only the servicer key may record narration.
    self.require_servicer_key();
    let key = format!("{asset_id}:{cycle_id}");
    // (anchor) a brief may only be recorded for a settled cycle.
    if self.receipts.get(&key).is_none() {
        self.env().revert(Error::CycleNotSettled);
    }
    // (idempotent) first brief is final.
    if self.briefs.get(&key).is_some() {
        self.env().revert(Error::BriefAlreadyRecorded);
    }
    self.briefs.set(&key, brief);
}
```

> **Q-servicer-gate:** the contract has no stored "servicer key" today — `distribute()` is callable by anyone (the quorum gate is cryptographic, not caller-based). SPEC-5 introduces an operational caller gate for `record_brief` only (to prevent brief spam/overwrite by third parties). This needs a stored servicer public key set at deploy/init. **Open question Q1 (§8):** add a `set_servicer_key` init, or reuse an existing account? *(Lean: add a one-time `init(servicer_key: PublicKey)` entrypoint, or store it at `register_asset` time from the caller. Resolve at impl.)* The gate is **operational only** — it protects narration integrity, not funds.

### 5.4 `get_brief` read entrypoint
```rust
/// Read the agent's per-cycle AI verification brief (SPEC-5), or `None` if
/// no brief was recorded for this cycle. Read-only; no caller gate; no revert.
pub fn get_brief(&self, asset_id: String, cycle_id: String) -> Option<String> {
    let key = format!("{asset_id}:{cycle_id}");
    self.briefs.get(&key)
}
```

---

## 6. Agent changes

### 6.1 `BriefClient` seam (new)
```ts
// packages/core/src/brief-client.ts (seam) — framework-free, like ChainClient
export interface BriefClient {
  /** Produce a per-cycle verification brief from the settled verdicts + outcome. */
  brief(opts: {
    assetId: string;
    cycleId: string;
    verdicts: SignedVerdict[];
    distributed: boolean;
    reputationSnapshot: VerifierScoreSnapshot[];
  }): Promise<string>;
}
```
- **Fake** (`packages/core/src/fakes.ts`): returns a deterministic templated brief (for tests — no network).
- **Real** (`agent/src/llm-brief-client.ts`): calls Anthropic (`ANTHROPIC_API_KEY`) or Ollama (`OLLAMA_HOST`) per AGENTS.md. The prompt is fixed (deterministic structure): "You are the Quittance servicer. Given these N signed verdicts and the on-chain outcome (distributed/halted), write a 2-3 sentence verification brief explaining what the verifiers confirmed and why funds moved/didn't. Do not decide; explain." The LLM output is the brief string. **No decision logic** — the LLM only narrates.

### 6.2 `runCycle` — call the LLM + `record_brief` after a successful distribute
After step 5 (the successful `distribute`), before returning:
```ts
// Step 5b (SPEC-5): produce + record the AI verification brief.
const brief = await briefClient.brief({
  assetId: cfg.assetId, cycleId,
  verdicts, distributed: true,
  reputationSnapshot: /* read from the receipt via chainClient, or pass through */,
});
await chainClient.callEntrypoint(cfg.vaultHash, "record_brief", {
  asset_id: cfg.assetId, cycle_id: cycleId, brief,
});
```
- The `ServicerDeps` gains a `briefClient: BriefClient`.
- The brief is recorded **only on a successful distribute** (halted cycles return early — no brief, parity with no-receipt-on-halt).
- **`CycleOutcome` gains `brief?: string`** so the caller (e2e/dashboard) has the narration.

### 6.3 Determinism boundary (absolute)
The LLM call is **after** the distribute has already settled. It cannot influence the settlement. If the LLM call fails or returns garbage, the cycle is **still settled** (funds already moved correctly); the brief is simply absent (`record_brief` not called → `get_brief` returns `None`). The agent should catch LLM errors and continue (brief is best-effort, not load-bearing).

---

## 7. The honest limitation — the brief is narration, not proof

The brief is **agent-attested narration** (the LLM's interpretation), not cryptographically verified. A compromised agent could write a misleading brief. But:
- It **cannot move funds** (the gate is cryptographic, SPEC-4).
- The **on-chain signatures + reputation (SPEC-4/6) remain the verifiable truth** — a judge who distrusts the brief reads the raw proof.
- The brief is **idempotent + anchored** — it can only be written for a settled cycle, once. It cannot rewrite history or attach to a halt.

This is the honest framing for the dashboard + README: *"The AI makes the cryptographically verified record legible. It does not establish the record — the on-chain signatures and reputation do. The brief reasons; the chain decides."* It's the difference between Quittance's agentic story and a competitor's: our AI explains a **verified** record, not an **attested** one.

---

## 8. Open questions (resolve at impl, not sign-off — except Q1)

- **Q1 (sign-off) — servicer-key gate for `record_brief`:** add a one-time `init(servicer_key)` / `set_servicer_key` entrypoint, or derive the authorized caller from `register_asset`'s caller? *(Lean: store a `servicer_key: PublicKey` set once at `register_asset` by the caller — reuses an existing entrypoint, no new init. Confirm at impl.)*
- **Q2 — brief length cap:** on-chain `String` — cap at, say, 1024 bytes (u16 length prefix is fine)? Reject longer via a new `BriefTooLong` error, or trust the agent? *(Lean: cap + revert — defends against a runaway LLM bloating state.)*
- **Q3 — reputation snapshot into the brief prompt:** pass the pre-increment `reputation_snapshot` (from the receipt) into the LLM prompt so the brief can reference "verifier v1 has a 100% accuracy track record"? *(Lean: yes — makes the brief richer and ties SPEC-5 to SPEC-6.)*
- **Q4 — halted-cycle off-chain narration:** the agent logs a brief for a halt to the demo log (not on-chain) for the showcase narrative? *(Lean: yes — the fraud cycle's "the chain refused because the quorum failed" is the demo moment; log it, don't store it.)*

---

## 9. Tests

**Contract (additive to the 35):**
| # | Case | Asserts |
|---|---|---|
| B1 | `get_brief` returns `None` before `record_brief` | absent pre-record |
| B2 | `record_brief` after a settled cycle stores the brief; `get_brief` returns it | round-trip |
| B3 | `record_brief` for an unsettled cycle → `CycleNotSettled` | brief anchored to a receipt |
| B4 | `record_brief` twice for the same cycle → `BriefAlreadyRecorded` (idempotent, first is final) | no overwrite |
| B5 | `record_brief` by a non-servicer key → rejected (operational gate) | brief integrity |
| B6 | `record_brief` over the length cap → `BriefTooLong` (if Q2 = cap) | state-bloat defense |

**Agent (additive to the 26):**
| # | Case | Asserts |
|---|---|---|
| A1 | successful distribute → `briefClient.brief` called → `record_brief` called with the brief | brief recorded post-settle |
| A2 | LLM call throws → cycle still settles, `record_brief` NOT called, outcome unchanged | brief is best-effort, not load-bearing |
| A3 | halted cycle → no `briefClient.brief` call, no `record_brief` | parity with no-receipt-on-halt |
| A4 | `CycleOutcome.brief` populated on success | caller gets the narration |

**Dashboard (additive to the 28):**
| # | Case | Asserts |
|---|---|---|
| D1 | receipt card renders the brief when present | "AI verification brief" block |
| D2 | receipt card omits the brief block when absent | graceful |
| D3 | `liveBrief` reader returns null gracefully until the bundled deploy | fallback |

---

## 10. Deploy note

Bundles with SPEC-1 + SPEC-4 + SPEC-6 — **one contract redeploy** (new hash → BUIDL-page update), already planned. SPEC-5 adds the `briefs` mapping + two entrypoints (storage-layout change → new deploy). The agent + e2e gain the `record_brief` call post-distribute. Dashboard read wires at the bundled deploy (same T9-style gate as the receipt/registry).

---

## 11. Done checklist

- [ ] `briefs` mapping + `record_brief` (servicer-gated, idempotent, anchored) + `get_brief` read.
- [ ] Servicer-key gate (Q1 resolved at impl).
- [ ] Tests B1–B6 green under `cargo odra test` (existing 35 stay green).
- [ ] `BriefClient` seam + fake (`core`); real LLM impl (`agent`, Anthropic/Ollama env).
- [ ] `runCycle` calls brief + `record_brief` post-settle; LLM errors don't break the cycle.
- [ ] Tests A1–A4 green (`agent`).
- [ ] Dashboard renders the brief (receipt card) + `liveBrief` fallback; tests D1–D3.
- [ ] Full TS workspace + dashboard build green.
- [ ] (Bundled deploy) on-chain smoke: brief readable after a settle; absent after a halt.
- [ ] README + dashboard copy state the narration-not-proof framing honestly.

---

*Approve SPEC-5 to unlock PLAN-5 → implementation on `feat/spec-1-receipts`. After SPEC-5: the bundled testnet deploy (SPEC-1+4+5+6 → new hash + e2e smoke), then SPEC-3 (positioning + interactive demo). The AI becomes load-bearing for explanation — honestly, over a verified record, never for decision.*