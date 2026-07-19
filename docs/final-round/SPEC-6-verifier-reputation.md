# SPEC-6 — On-Chain Verifier Reputation (the unique moat)

> **Workstream 3 of the Final-Round campaign** (see `PRD.md` §9). The unique moat — no competitor tracks verifier accuracy (code-verified); maps directly to Casper's example-direction-#2 wording (*"verifiable on-chain identity and reputation score based on historical accuracy"*).
> **Status:** Draft for RECTOR's sign-off. **No implementation until approved.**
> **Depends on:** SPEC-1 (extends its `Receipt` with a reputation snapshot) + SPEC-4 (extends its verifier registry: the `AssetConfig.verifiers` allowlist becomes the seed for a global per-verifier reputation record).
> **Day-0 spike: none needed.** Uses only Odra APIs already proven by SPEC-4 (`Mapping`, `env()`, CLValue-typed storage). No new host calls.

---

## 1. Goal

Give each verifier a **queryable on-chain reputation** — a transparent track record of how often it responded and how often its verdict agreed with the settling outcome. A judge looking at the dashboard sees, per verifier: cycles seen, cycles voted, cycles agreed, and derived ratios (response rate, accuracy). The single-operator residual gap (PRD §13 — "all 3 verifiers run by RECTOR") is bridged by **transparency**: even with one operator, each verifier's accuracy is on the record, so a consistently-wrong verifier is *visible*, not hidden.

**North-Star link (PRD G2):** close soft spot **S-rep** ("who are these verifiers, and why trust them?"). This is the unique moat — neither Concordia (address-collation) nor AgentPay (proof log) tracks verifier accuracy. SPEC-6 is **informational**, not a trust gate: the quorum stays signature-based (SPEC-4); reputation never moves funds or changes the threshold.

---

## 2. Scope

**In:**
- A **global verifier registry** `verifier_registry: Mapping<PublicKey, VerifierReputation>`, auto-seeded from `register_asset` (verifiable on-chain identity from registration).
- Per-verifier **raw count** accumulation inside `distribute()` on every **successful** settlement: `cycles_seen`, `cycles_voted`, `cycles_agreed` (see §4 for the exact semantics).
- `Receipt` extension with a **reputation snapshot** (`Vec<VerifierScoreSnapshot>`) captured *before* this cycle's increment — the reputation each verifier *brought to* this settlement.
- Two read entrypoints: `get_verifier_reputation(pubkey)` + `get_verifier_registry()`.
- Dashboard: a `VerifierReputationCard` (response rate, accuracy, last verdict) on the issuer view; a per-verifier line on the receipt card.
- Tests RP1–RP10 (incl. the honest-limitation test: halted cycles do not score).

**Out (deferred / fenced):**
- **Staking / slashing / marketplace economics** (PRD non-goal — reputation ≠ economics; reputation is transparent accuracy tracking).
- **Reputation-gated quorum** — the threshold and signature gate stay exactly as SPEC-4 left them; reputation never decides fund release.
- **Halted-cycle scoring** — the contract reverts `QuorumNotMet` before any write, so a halted cycle scores nothing (see §7 — deliberate, defensible).
- **Verifier removal / churn governance** — `register_asset` is append-only; a registry entry, once created, persists. Fine for a demo; documented.
- **EWMA / decay weighting** — simple raw counts for the demo; EWMA is the documented production design (PRD Q5 resolved).
- **Agent / adapter changes** — none. SPEC-6 reuses the existing parallel-arrays `distribute()` ABI verbatim; the contract derives all reputation signal from `cfg.verifiers` + the already-passed `signers`/`verdicts`. Zero new params.

---

## 3. Key design decision — score on-chain from data `distribute()` already holds

The contract does **not** need the agent to report anything new. On a successful `distribute()` it already has:

| Signal | Source (already in-scope at `distribute()` time) |
|---|---|
| **Opportunity** (cycles seen) | `cfg.verifiers` — the full registered set for this asset. Every registered verifier had the chance to respond. |
| **Response** (cycles voted) | the verified `signers` set — the subset that submitted a valid SPEC-4 signature. Registered-minus-submitted = non-responders. |
| **Agreement** (cycles agreed) | each verified signer's `verdicts[i]` — `yes` agrees with the settling outcome (a distribute only settles on ≥quorum yes). |
| **Ground truth** | the cycle **settled** = the cashflow was verified-true. On a settled cycle, a `yes` verdict is accurate; a `no` verdict is inaccurate. (Convergence of agreement-with-outcome and accuracy-vs-truth in this demo — PRD Q4 resolved.) |

So reputation is **authoritative and on-chain**, not agent-attested. The agent cannot inflate a verifier's reputation — it can only submit signatures, and the contract scores from those + the registered set. A compromised agent that submits a forged signature gets it rejected by SPEC-4 (not counted); a bribed verifier that signs `yes` on a fraud cycle causes a halt (no settlement → no score update → no reward).

This is the property that makes the moat **honest**: the only way to accumulate `cycles_agreed` is to vote `yes` on a cycle that actually settles (i.e. ≥quorum of registered verifiers actually agreed the cashflow arrived). You cannot game reputation; you can only earn it.

---

## 4. Data model

### 4.1 Global registry entry
```rust
/// On-chain reputation for one verifier (SPEC-6). Auto-created (zeroed) the
/// first time a verifier is listed in ANY `register_asset` call; accumulated
/// inside `distribute()` on every successful settlement. Global across all
/// assets — a verifier's reputation is its identity, not per-asset. Read via
/// [`ServicerVault::get_verifier_reputation`] / [`get_verifier_registry`].
#[odra::odra_type]
pub struct VerifierReputation {
    pub pubkey: PublicKey,
    /// Times this verifier was registered for an asset whose cycle settled
    /// (the opportunity count). Incremented for every registered verifier on
    /// every successful distribute, responder OR not.
    pub cycles_seen: u32,
    /// Times this verifier submitted a valid SPEC-4 signature for a settling
    /// cycle (the response count). `cycles_seen - cycles_voted` = non-response.
    pub cycles_voted: u32,
    /// Times this verifier's verdict was `yes` on a settling cycle (agreement
    /// with the outcome — on a settled cycle, `yes` is accurate).
    pub cycles_agreed: u32,
    /// Most recent verdict this verifier cast on a settling cycle
    /// (`true` = yes, `false` = no). `None` until first participation.
    pub last_verdict: Option<bool>,
    /// Most recent `(asset_id, cycle_id)` this verifier was scored on.
    pub last_cycle: Option<String>,
}
```

**Derived ratios (computed off-chain in the dashboard — no on-chain fixed-point math):**
- response rate = `cycles_voted / cycles_seen`
- accuracy = `cycles_agreed / cycles_voted` (of votes cast, how often right) — and/or `cycles_agreed / cycles_seen` (overall correctness); dashboard shows both clearly labeled.

### 4.2 `Receipt` extension (SPEC-1's struct grows again)
Add a **pre-increment snapshot** — the reputation each verifier brought *to* this settlement:
```rust
// added to Receipt (SPEC-1, already extended by SPEC-4):
pub reputation_snapshot: Vec<VerifierScoreSnapshot>,

#[odra::odra_type]
pub struct VerifierScoreSnapshot {
    pub signer: PublicKey,
    pub cycles_seen: u32,
    pub cycles_voted: u32,
    pub cycles_agreed: u32,
}
```
**Snapshot timing:** the snapshot records the registry state **before** this cycle's increment — so a receipt shows "the track record that preceded this settlement," i.e. the basis on which a judge could evaluate the verifiers *at the moment they voted*. The increment is applied after the snapshot is captured (§5.4).

### 4.3 Storage added to `ServicerVault`
```rust
/// `PublicKey -> VerifierReputation` (SPEC-6). Global across assets;
/// auto-seeded from `register_asset`; accumulated in `distribute()`.
verifier_registry: Mapping<PublicKey, VerifierReputation>,
```

---

## 5. Contract changes

### 5.1 `register_asset` — seed the registry (verifiable identity from registration)
At the end of `register_asset`, for each `verifier` in the passed list, if `verifier_registry.get(&verifier).is_none()`, create a zeroed entry. This gives every registered verifier a **queryable on-chain identity** from the moment it's authorized — matching Casper example-#2's "verifiable on-chain identity **and** reputation score." A verifier listed by multiple assets keeps a single accumulating entry (idempotent seed).

### 5.2 Two read entrypoints
```rust
/// Read one verifier's reputation (SPEC-6). `None` if never registered.
pub fn get_verifier_reputation(&self, pubkey: PublicKey) -> Option<VerifierReputation> {
    self.verifier_registry.get(&pubkey)
}

/// Read the full verifier registry (SPEC-6) — every verifier ever authorized
/// across all assets, with its accumulated track record. Dashboard uses this
/// to render the reputation panel.
pub fn get_verifier_registry(&self) -> Vec<VerifierReputation> {
    // Odra Mapping has no native iterate; this is implemented by tracking a
    // companion `verifier_keys: Vec<PublicKey>` index set maintained alongside
    // the registry (push on first-seen). See §5.5.
    self.verifier_keys
        .iter()
        .filter_map(|pk| self.verifier_registry.get(pk))
        .collect()
}
```

### 5.3 `get_receipt` — unchanged signature
The `Receipt` already returned by `get_receipt` now carries `reputation_snapshot`; no new entrypoint. SPEC-1's read path is unchanged.

### 5.4 `distribute()` — score after the gate, alongside the Receipt write
After the quorum gate passes (SPEC-4) and before emitting `Distributed`, **after** building the Receipt's reputation snapshot from the *current* (pre-increment) registry state:

```
// (already computed by SPEC-4): verified_signers: Vec<PublicKey> (the yes-voters),
//                                 all_verified: the set of all signers that passed the gate.
// registered = cfg.verifiers (the opportunity set).

// 1. SNAPSHOT (pre-increment) — capture each registered verifier's current
//    reputation into the Receipt's reputation_snapshot.
// 2. SCORE every registered verifier:
for each verifier v in cfg.verifiers:
    rep = verifier_registry.get_or_default(v)  // must exist (seeded at register)
    rep.cycles_seen += 1
    if v in all_verified_signers (submitted a valid sig):
        rep.cycles_voted += 1
        rep.last_verdict = Some(verdicts[i_for_v])
        rep.last_cycle = Some("{asset_id}:{cycle_id}")
        if verdicts[i_for_v] == true:
            rep.cycles_agreed += 1
    verifier_registry.set(v, rep)
// 3. store the Receipt (with the pre-increment snapshot).
// 4. emit Distributed (unchanged).
```

**Ordering:** snapshot first, then increment, then Receipt-write. This guarantees `Receipt.reputation_snapshot` == the reputation that *preceded* this cycle (RP6). The increment is persisted to the registry regardless of the snapshot copy.

**No-verdict verifiers** (registered, didn't submit): `cycles_seen += 1` only — their non-response is recorded as a missed opportunity (lowers response rate). They are NOT given a `last_verdict` update.

**No-signature / unregistered / forged signers** (in the arrays but rejected by SPEC-4): not in `cfg.verifiers`, so not scored at all — they're not in the registry.

### 5.5 `verifier_keys` index (for `get_verifier_registry` iteration)
Odra `Mapping` has no iteration primitive. Add a companion `Vec<PublicKey>` kept in sync with the registry's key set: push a pubkey on first-seen in `register_asset` (dedup). Cheap (verifier counts are tiny — 3 in the demo). Documented as the standard Odra pattern for iterable mappings.

```rust
verifier_keys: Vec<PublicKey>,   // index of registry keys (first-seen order)
```

---

## 6. Trust boundary — UNCHANGED (this is the point)

| | Before (SPEC-4) | After (SPEC-6) |
|---|---|---|
| Quorum gate | signature-based (SPEC-4) | **signature-based (SPEC-4) — unchanged** |
| Reputation's role | none | **informational only — never gates fund release** |
| Agent must report | signed verdicts | **signed verdicts — unchanged (no new params)** |
| Servicer key can inflate reputation | n/a | **no — scores derive from registered set + verified sigs** |

Reputation is a **read-side transparency layer**, not a write-side authority. It cannot break the happy/fraud paths because it adds writes *only after* a distribute already succeeded — exactly where the Receipt is already written (SPEC-1). A SPEC-6 bug can at worst make the dashboard show wrong counts; it cannot move funds.

---

## 7. The honest limitation — halted cycles do not score

The fraud showcase (1/3 yes → `QuorumNotMet` revert) **reverts before any state write** (SPEC-1's "no phantom receipts" discipline, unchanged). Therefore a halted cycle scores **nothing** — neither the compromised `yes` verifier nor the correct `no` verifiers get a reputation update from that cycle.

This is **deliberate and defensible**, and it is the property that keeps the moat honest:
- The contract has **no authoritative ground truth** on a halted cycle — settlement is what establishes "the cashflow arrived." Without settlement, "who was right?" is off-chain judgment, not on-chain fact. Scoring it would require agent attestation (re-introducing the trust surface SPEC-4 removed). We refuse.
- A compromised verifier **cannot inflate its reputation** via a fraud cycle — the cycle halts, no update, no reward. The only way to accumulate `cycles_agreed` is to vote `yes` on a cycle that actually settles.
- A verifier that consistently votes `no` on settling cycles accumulates `cycles_voted` but not `cycles_agreed` → low accuracy, *visible* on-chain. That's the signal.

**What the judge sees:** on the dashboard, each verifier's reputation reflects its **track record on settled cycles**. The fraud showcase stands on its own (the chain refuses to distribute — that's the product, SPEC-4). Reputation is the *transparency* layer over the verifiers' settling-cycle history. Documented honestly in the README + dashboard copy.

---

## 8. Dashboard

Self-contained Next.js, no new deps (AGENTS.md constraint — `next`/`react`/`react-dom`/`lucide-react` only):

- **`VerifierReputationCard`** — one row per verifier (label, pubkey truncated, `cycles_seen`/`cycles_voted`/`cycles_agreed`, response rate %, accuracy %, last verdict badge). Shown on the issuer view, sourced from `get_verifier_registry()`. Receipt aesthetic (Space Mono / IBM Plex Mono), lucide icons (no Unicode emojis as icons).
- **Receipt card extension** — `DistributionReceiptCard` (SPEC-1) gains a compact "reputation at settlement" line per verifier from `reputation_snapshot` (pre-increment counts), framed as "the track record each verifier brought to this cycle."
- **Read path:** extend `lib/chain.ts` with a `liveVerifierRegistry(contractHash)` raw-RPC read (same `query_state` pattern as `liveDistributionReceipt`), force-dynamic + try-catch fallback (CI-safe, mirrors the existing pattern). CLValue decode of the `Vec<VerifierReputation>` wires when the receipt-bearing contract is deployed (bundled deploy, §10); until then returns null gracefully (same philosophy as SPEC-1 T9).
- **Copy:** honest — "reputation tracks settled cycles; halted cycles don't score (the contract can't authoritatively establish ground truth without settlement)."
- **Tests:** unit test the render + the chain-read fallback (mirror the 19 existing dashboard tests).

---

## 9. Tests (contract, additive to the existing 25)

| # | Case | Asserts |
|---|---|---|
| RP1 | `register_asset` seeds zeroed registry entries for each verifier | `get_verifier_reputation(vk)` returns `Some` with all-zero counts (identity exists from registration) |
| RP2 | happy distribute (3 yes): all 3 registered verifiers | `cycles_seen += 1` for all; `cycles_voted += 1` for all; `cycles_agreed += 1` for all; `last_verdict = Some(true)` |
| RP3 | distribute with 2 yes + 1 valid-signed no (quorum met) | all 3 `seen+1`; the 2 yes `voted+1 agreed+1`; the 1 no `voted+1 agreed+0`; no-voter `last_verdict = Some(false)` |
| RP4 | distribute with 2 yes + 1 non-responder (only 2 signers submitted) | all 3 `seen+1`; 2 responders `voted+1 agreed+1`; non-responder `voted+0 agreed+0`, `last_verdict` unchanged |
| RP5 | `get_verifier_reputation` returns accumulated stats; `get_verifier_registry` lists all 3 in first-seen order | counts match RP2's outcome |
| RP6 | `Receipt.reputation_snapshot` == registry state **before** this cycle's increment | snapshot counts are the pre-cycle values (the reputation brought to this cycle) |
| RP7 | halted/fraud cycle (1 yes → `QuorumNotMet` revert) does **not** update any reputation | all counts unchanged after the revert (the honest limitation, as a test) |
| RP8 | two sequential successful distributes accumulate (counts grow across cycles) | `cycles_seen == 2` etc. after the second settle |
| RP9 | a verifier shared across two assets has **one** accumulating registry entry (global registry, cross-asset) | the shared verifier's counts = sum of both assets' settles |
| RP10 | an unregistered-but-validly-signing pubkey (rejected by SPEC-4) is **not** scored (not in registry) | its reputation stays `None`; the distribute still succeeds if registered quorum met |

RP7 is the honest-limitation proof — it asserts the contract does *not* pretend to score halted cycles. RP6 is the snapshot-timing proof. RP9 proves the registry is global, not per-asset. All run under `cargo odra test` (real Ed25519, same `vk(seed)` helper as SPEC-4).

---

## 10. Deploy note

Bundles with SPEC-1 + SPEC-4 — **one contract redeploy** (new hash → BUIDL-page update via "Manage Submission"), already planned. SPEC-6 adds storage (`verifier_registry` mapping + `verifier_keys` index) + grows the `Receipt` struct (the `reputation_snapshot` field) — a storage-layout change → new deploy, not an in-place upgrade. The agent + e2e harness need **no** change (the `distribute` ABI is unchanged; reputation is contract-internal). Dashboard read wires at the bundled deploy (same T9-style gate as SPEC-1).

---

## 11. Open questions (resolve at impl, not sign-off)

- **Q-snapshot-size:** the `reputation_snapshot` holds one entry per *registered* verifier (3 in the demo) — trivially small. If verifier-count scales, consider snapshotting only the *participating* verifiers. Out of scope for the final round; the full-registered snapshot is more informative for a judge.
- **Q-ratio-display:** which ratio leads on the card — response rate or accuracy? *(Lean: accuracy leads, response rate secondary — accuracy is the moat narrative.)*
- **Q-last-cycle-format:** store `"{asset_id}:{cycle_id}"` (matches the `distributed`/`receipts` key convention) or a struct? *(Lean: the string — one convention.)*
- **Q-registry-iterate:** confirm the `verifier_keys: Vec<PublicKey>` first-seen-index pattern is the idiomatic Odra approach (vs. a `Mapping<u32, PublicKey>` + counter). *(Lean: the `Vec` — simplest for tiny counts.)*

---

## 12. Done checklist

- [ ] `VerifierReputation` + `VerifierScoreSnapshot` types; `verifier_registry` mapping + `verifier_keys` index storage.
- [ ] `register_asset` seeds zeroed registry entries (first-seen idempotent).
- [ ] `distribute()` scores every registered verifier (seen/voted/agreed/last_verdict) after the SPEC-4 gate; snapshot before increment.
- [ ] `Receipt` carries `reputation_snapshot` (pre-increment).
- [ ] `get_verifier_reputation` + `get_verifier_registry` read entrypoints.
- [ ] Tests RP1–RP10 green under `cargo odra test` (existing 25 stay green).
- [ ] Dashboard: `VerifierReputationCard` + receipt-card extension; honest copy; chain-read fallback CI-safe.
- [ ] Dashboard unit tests for render + fallback.
- [ ] Full TS workspace + dashboard build green.
- [ ] (Bundled deploy) on-chain smoke: registry readable; reputation accumulates across two settles.
- [ ] README + dashboard copy state the halted-cycle limitation honestly.

---

*Approve SPEC-6 to unlock PLAN-6 → implementation on `feat/spec-1-receipts`. After SPEC-6: the bundled testnet deploy (SPEC-1+4+6 → new hash + e2e smoke), then SPEC-5 (agentic brief), then SPEC-3 (positioning + interactive demo). The moat is transparent, on-chain, and unhameable — exactly the property a security-aware jury respects.*