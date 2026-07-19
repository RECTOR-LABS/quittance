# SPEC-1 — Queryable On-Chain Receipts

> **Workstream 1 of the Final-Round campaign** (see `PRD.md` §9). The storage primitive that SPEC-4/5/6 write into.
> **Status:** Draft for RECTOR's sign-off. **No implementation until approved.**
> **Depends on:** nothing (first workstream). **Unblocks:** SPEC-4 (writes signatures into the Receipt), SPEC-5 (brief hash), SPEC-6 (reputation snapshot).
> **Day-0 spike (SPEC-4's, already GREEN):** Odra 2.8.1 `env().verify_signature(&Bytes, &Bytes, &PublicKey) -> bool` exists — confirmed. Does not affect SPEC-1.

---

## 1. Goal

Turn the `Distributed` *event* into **queryable on-chain state**: a stored `Receipt` per `(asset_id, cycle_id)`, readable via a `get_receipt` entrypoint and rendered in the dashboard. A judge can confirm a cycle's quorum proof + payout without parsing events.

**North-Star link (PRD G4):** close soft spot **S1** ("distribution is an event — how do I independently verify a receipt?"). This SPEC does **not** change the trust model — it records what `distribute()` already attests. Cryptographic verification is SPEC-4.

---

## 2. Scope

**In:**
- New `Receipt` Odra type + `receipts: Mapping<String, Receipt>` storage.
- Populate the Receipt inside `distribute()` (values already computed; no logic change).
- `get_receipt(asset_id, cycle_id)` read entrypoint.
- Dashboard: query + render the receipt (receipt aesthetic, holder + issuer views).
- Tests (storage, read, idempotency-preserving, dust-recorded).

**Out (deferred to later SPECs):**
- Verifier **signatures** in the Receipt → SPEC-4.
- AI **brief hash** → SPEC-5.
- **Reputation snapshot** → SPEC-6.
- Historical **backfill** of qualifier-round cycles (Q-below → new cycles only).
- Any change to the quorum gate, trust boundary, or payout math.

---

## 3. Data model

A new Odra type, stored under the **same key convention** as the existing `distributed` mapping (`"{asset_id}:{cycle_id}"`) — consistency with the committed agent read path.

```rust
#[odra::odra_type]
pub struct Receipt {
    pub asset_id: String,
    pub cycle_id: String,
    pub settled_at: u64,            // block timestamp via env (impl confirms exact API)
    pub total_distributed: U512,   // == event.total == `paid`
    pub dust_retained: U512,       // == pool - paid (already computed, currently discarded to the pool)
    pub holder_count: u32,         // == cfg.holders.len()
    pub quorum_required: u8,       // == cfg.quorum
    pub signers: Vec<PublicKey>,         // distinct registered signers that satisfied the gate (quorum proof)
    pub verdict_hashes: Vec<[u8; 32]>,   // provenance, as supplied to distribute()
}
```

> **Forward-compatibility:** SPEC-4/5/6 will **extend** this struct (add `verifier_signatures`, `brief_hash`, `reputation_snapshot`). Designing the core now and extending per-SPEC keeps each SPEC self-contained. On `casper-test` (frequent redeploy) the struct-growth cost is negligible.

**Storage field added to `ServicerVault`:**
```rust
receipts: Mapping<String, Receipt>,   // key: "{asset_id}:{cycle_id}"
```

---

## 4. Contract changes

### 4.1 Populate in `distribute()` (additive — between current step 7 and step 8)

After `self.distributed.set(&key, true);` and before `self.env().emit_event(...)`, build and store the Receipt from values `distribute()` **already computes**:

```rust
self.receipts.set(&key, Receipt {
    asset_id: asset_id.clone(),
    cycle_id: cycle_id.clone(),
    settled_at: self.env().block_time(),            // impl confirms exact Odra API
    total_distributed: paid,
    dust_retained: pool - paid,                      // already computed; currently just re-stored in pools
    holder_count: cfg.holders.len() as u32,
    quorum_required: cfg.quorum,
    signers: distinct_registered.clone(),            // already computed (the quorum proof)
    verdict_hashes: verdict_hashes.clone(),
});
```

**The `Distributed` event stays unchanged** (back-compat for the agent/observer path). The Receipt is the queryable mirror of the same facts.

### 4.2 New read entrypoint

```rust
/// Read the stored receipt for a settled cycle, or `None` if not distributed.
pub fn get_receipt(&self, asset_id: String, cycle_id: String) -> Option<Receipt> {
    let key = format!("{asset_id}:{cycle_id}");
    self.receipts.get(&key)
}
```

Read-only, no caller gate, no revert. Mirrors how `get_asset`/`pool_of` already expose state.

### 4.3 Trust boundary — UNCHANGED

SPEC-1 stores what `distribute()` already attests under the existing trust boundary (agent's `signers` list trusted; no on-chain sig check — that's SPEC-4). **No change to the quorum gate, payout math, or idempotency.** This is why SPEC-1 is low-risk.

---

## 5. Dashboard (read + render)

`packages/dashboard` (self-contained Next.js, no internal workspace deps per AGENTS.md):

- **Query:** add a receipt reader alongside the existing balance read in `lib/chain.ts` (same `casper-js-sdk` v5 query pattern — `queryDictItem`/dictionary-read against the vault's `receipts` named key). Force-dynamic + try-catch fallback like `holder/page.tsx` (CI-safe).
- **Render:** a Receipt component in the Space Mono / IBM Plex Mono receipt aesthetic (AGENTS.md convention). Shown in both issuer + holder views: cycle id, settled time, total distributed, the quorum proof (signers + verdict hashes), dust retained. No new deps.
- **Tests:** unit test the render + the chain-read fallback (mirror the 13 existing dashboard tests).

---

## 6. Tests (contract, additive to the existing 12)

| # | Case | Asserts |
|---|---|---|
| R1 | `get_receipt` returns `None` before distribute | receipt absent pre-settlement |
| R2 | after happy distribute, `get_receipt` mirrors the event | all fields equal (`total`, `signers`, `verdict_hashes`, `holder_count`, `quorum_required`) |
| R3 | `dust_retained` matches `pool - paid` | dust is recorded, not lost (pairs with existing dust test #12) |
| R4 | under-quorum revert leaves **no** receipt | fraud path writes nothing (S1: no phantom receipts) |
| R5 | idempotent re-distribute does **not** overwrite the receipt | first receipt is final (AlreadyDistributed fires first) |
| R6 | distinct cycles produce distinct receipts | `(a,c1)` ≠ `(a,c2)` |

All run under OdraVM (`cargo odra test`) alongside the existing suite.

---

## 7. Edge cases & decisions

- **Idempotency preserved** — the `AlreadyDistributed` guard at the top of `distribute()` fires before the Receipt write, so R5 holds by construction.
- **No phantom receipts on fraud** — the Receipt write is after the quorum gate; a reverted `distribute()` writes nothing (R4).
- **Backfill (PRD Q6) — DECIDED: new cycles only.** Pre-SPEC-1 cycles keep their `Distributed` event as the record; the stored Receipt exists only for cycles distributed post-deploy. Documented honestly in README.
- **Key format** — `"{asset_id}:{cycle_id}"`, identical to the `distributed` mapping (one committed convention; the agent already reads this shape).

---

## 8. Deploy note (PRD Q7 — resolve at impl)

Adding the `receipts` mapping + Receipt type changes contract storage layout → almost certainly a **new vault deploy** (new contract hash → BUIDL-page update via "Manage Submission") rather than an in-place upgrade. Confirm the idiomatic Odra/Casper upgrade path at impl day-0; if a package-hash-preserving upgrade is clean, prefer it (keeps the BUIDL-page hash stable). Either way, **SPEC-1 is additive — it cannot break the proven happy/fraud paths.**

---

## 9. Open questions (resolve at impl, not sign-off)

- **Q-settled-at:** exact Odra API for block timestamp (`env().block_time()` vs block height). Impl confirms; `u64` field either way.
- **Q-read-cost:** `get_receipt` returns the full struct by value — fine for a 3-verifier demo; if verifier-count scales, consider a lighter view. Out of scope for the final round.
- **Q-dashboard-query:** exact `casper-js-sdk` v5 dictionary-read call for a named-key mapping — confirm against the existing `lib/chain.ts` pattern (avoid v2 API per repo gotcha #1).

---

## 10. Done checklist

- [ ] `Receipt` type + `receipts` mapping in `ServicerVault`.
- [ ] `distribute()` populates the Receipt (no logic change to gate/payout/idempotency).
- [ ] `get_receipt` read entrypoint.
- [ ] Tests R1–R6 green under `cargo odra test` (existing 12 stay green).
- [ ] Dashboard reads + renders the receipt (receipt aesthetic); fallback CI-safe.
- [ ] Dashboard unit tests for render + fallback.
- [ ] `main` green; branch → CI → merge small.
- [ ] If new deploy: contract hash updated on the BUIDL page.

---

*Approve SPEC-1 to unlock implementation. SPEC-4 (on-chain signature verification — spike GREEN) is next.*
