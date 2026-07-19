# SPEC-4 — On-Chain Signature Verification (the deep move)

> **Workstream 2 of the Final-Round campaign** (see `PRD.md` §9). The real edge vs demo-simple competitors (code-verified: Concordia = address-collation L2.5, AgentPay = log L1; we target L3).
> **Status:** Draft for RECTOR's sign-off. **No implementation until approved.**
> **Depends on:** SPEC-1 (extends its `Receipt`). **Extends:** the `Receipt` struct with verifier signatures.
> **Day-0 spike: ✅ GREEN** — Odra 2.8.1 `self.env().verify_signature(message: &Bytes, signature: &Bytes, public_key: &PublicKey) -> bool` confirmed (Casper native host fn; works in OdraVM + wasm).

---

## 1. Goal

`distribute()` stops trusting the servicer agent for the quorum. It takes **signed verdicts** and the **contract itself verifies each Ed25519 signature** on-chain against a registered verifier pubkey, counts valid *distinct-verifier* yes-votes, and distributes only if ≥ quorum. A forged signature, a replayed verdict, or the servicer key alone → **rejected on-chain**.

**North-Star link (PRD G1):** close soft spot **S3** (the deepest — "the agent attests the quorum off-chain; the contract trusts the servicer key"). After SPEC-4, "verify, not attest" is a **protocol property**, not a demo claim. This is the strongest on-chain verification in the finalist field.

---

## 2. Scope

**In:**
- On-chain Ed25519 verification of each verdict signature inside `distribute()`.
- A **canonical message scheme** the contract can reconstruct identically to the off-chain signer (see §4 — this fixes a real fragility).
- `distribute()` takes `SignedVerdict`s (not a trusted `signers` list); verified signers counted.
- Replay protection (verdict bound to `asset_id` + `cycle_id`) — folds in L4.
- `Receipt` extended with verifier signatures (provenance).
- Agent adapter: pass `SignedVerdict[]` to `distribute` (the agent already collects them).
- Tests: full security matrix (happy / forged-sig / replay / sub-quorum / unregistered).

**Out (deferred):**
- Verifier registry **governance** (add/remove beyond `register_asset`) + **reputation** → SPEC-6.
- Verifier marketplace / staking / slashing (post-hackathon).
- Changing the 2-of-3 threshold rule (unchanged — only *where* it's enforced moves).

---

## 3. Key design decision — canonical message scheme (must change)

**Problem:** the existing off-chain signer (`packages/core/src/sign.ts`) signs `sha256(canonicalJSON(verdict))` where the JSON is TS `JSON.stringify` over 5 fields in fixed order. For on-chain verification the contract would have to **reconstruct that exact JSON string in Rust** — fragile (escaping, spacing, number format) and exactly what a security jury flags. Signing a hash also forces a SHA-256 host call on-chain.

**Decision: switch the canonical scheme to length-prefixed binary, signed directly.**

| | Before (qualifier) | After (SPEC-4) |
|---|---|---|
| Canonical form | `sha256(JSON.stringify(verdict))` | `canonicalBytes(verdict)` — length-prefixed binary |
| What's signed | the 32-byte SHA-256 hash | the raw canonical bytes (Ed25519 signs arbitrary bytes) |
| Contract reconstructs | JSON string + SHA-256 (fragile + host hash) | identical length-prefixed bytes (trivial, exact) |
| On-chain hash API needed | yes (SHA-256) | **no** |

**Why this is correct, not gold-plating:** the whole point of SPEC-4 is *correct* on-chain verification. JSON-matching across TS/Rust is a real bug surface. Binary length-prefixing is unambiguous + trivially reconstructable in Odra. This is a **bounded change to `core/sign.ts` + its tests** (the `SignedVerdict` interface is unchanged; only what the signature is *over* changes). It is in-scope for SPEC-4 because the message format *is* the contract between signer and verifier.

---

## 4. The canonical-bytes format (precise — both sides agree byte-for-byte)

Over the 5 Verdict fields in fixed order. Lengths are **u16 big-endian**; fields are UTF-8; verdict is 1 byte.

```
canonicalBytes(v) =
    [u16 BE: assetId.len()]   assetId_utf8
  || [u16 BE: cycleId.len()]  cycleId_utf8
  || [0x01 if v.verdict else 0x00]
  || [u16 BE: observedAmount.len()]  observedAmount_utf8
  || [u16 BE: source.len]     source_utf8
```

- **TS (`core/sign.ts`):** build the byte array with `TextEncoder` + `DataView.setUint16(off, len, false)` (big-endian). `ed.sign(canonicalBytes(v), sk)`.
- **Odra contract:** reconstruct identically — `len.to_be_bytes() ++ field.as_bytes() ++ …` over the same 5 fields, same order. No host hash call.

Field-length cap: u16 ⇒ each field ≤ 65535 bytes (vast headroom for demo values). Unambiguous: the length-prefix removes any concatenation ambiguity.

> **Production note (documented, not built):** if Verdict gains fields, update both sides + the compile-time exhaustiveness guard already in `sign.ts` (`VERDICT_KEY_ORDER`) — extend it to cover the binary scheme.

---

## 5. Data model

### 5.1 What `distribute()` receives (new)
```rust
/// A verdict + its Ed25519 signature, presented to `distribute()` for on-chain
/// verification (SPEC-4). `verdict` carries the 5 fields needed to reconstruct
/// the canonical bytes; `signature` is over those bytes; `signer` must be a
/// registered verifier pubkey.
#[odra::odra_type]
pub struct SignedVerdict {
    pub asset_id: String,
    pub cycle_id: String,
    pub verdict: bool,
    pub observed_amount: String,
    pub source: String,
    pub signature: Bytes,      // Casper Ed25519 Signature, serialized bytes
    pub signer: PublicKey,     // registered verifier pubkey
}
```
(Mirrors the existing TS `SignedVerdict { verdict, signature, signer }` — the 5 verdict fields are flattened for clean CLValue encoding.)

### 5.2 `Receipt` extension (SPEC-1's struct grows)
Add the cryptographically-verified signature records:
```rust
// added to Receipt (SPEC-1):
pub verifier_signatures: Vec<VerifierSignature>,  // populated by SPEC-4

#[odra::odra_type]
pub struct VerifierSignature {
    pub signer: PublicKey,
    pub verdict: bool,
    pub signature: Bytes,
}
```
`signers` (from SPEC-1) now means **cryptographically verified** distinct signers (stronger semantics — same field, upgraded meaning).

---

## 6. `distribute()` — the verification logic

New signature (replaces the trusted-`signers` form):
```rust
pub fn distribute(
    &mut self,
    asset_id: String,
    cycle_id: String,
    signed_verdicts: Vec<SignedVerdict>,
)
```
Inside `distribute()`, the **quorum gate (step 3)** is replaced:

```
for each sv in signed_verdicts:
    1. BIND: sv.asset_id == asset_id && sv.cycle_id == cycle_id   (else skip — replay/foreign)
    2. REGISTERED: cfg.verifiers.contains(sv.signer)               (else skip)
    3. VERIFY: env().verify_signature(&canonical_bytes(sv), &sv.signature, &sv.signer)  (else skip)
    4. if sv.verdict == true && signer not already counted: push to verified_yes
if verified_yes.len() < cfg.quorum: revert QuorumNotMet
```
- `canonical_bytes(sv)` reconstructs the §4 bytes from the 5 fields.
- **Distinct-verifier** counting (one pubkey = one vote) — anti-collusion by construction.
- Only **valid, registered, bound, yes** signatures count.
- Payout math, idempotency, dust — **unchanged** (steps 4–7 of the current `distribute()`).

`distinct_registered` (the verified signers) is recorded in the Receipt + `Distributed` event, same as today — but now it's the **cryptographically verified** set.

---

## 7. Trust boundary — the SHIFT (this is the whole point)

| | Before (qualifier) | After (SPEC-4) |
|---|---|---|
| Who counts the quorum | the agent (off-chain) | **the contract (on-chain)** |
| `distribute()` trusts | the agent's `signers` list | **only Ed25519 signatures** |
| Servicer key alone can release funds | yes (if it lists ≥quorum registered pubkeys) | **no** (needs ≥quorum valid signatures) |
| Forged / replayed verdict | accepted (not checked) | **rejected on-chain** |

The servicer key still gates *who may call* `distribute` (operational), but no longer *whether funds release* (cryptographic). This is L0 → L3.

---

## 8. `core/sign.ts` changes (the canonical scheme, §3)

- `canonicalHash(v) -> Hash` → **`canonicalBytes(v) -> Uint8Array`** (length-prefixed binary, §4).
- `signVerdict` signs `canonicalBytes(v)` directly (drop the SHA-256 over JSON).
- `verifyVerdict` verifies over `canonicalBytes(v)`.
- `sign.test.ts` (13 tests): update the determinism/round-trip assertions to the new scheme (the `SignedVerdict` interface is unchanged; only the signature bytes change).
- `verdict_hashes` provenance (stored in the Receipt/event) → derived as a display digest of each signature (or replaced by `verifier_signatures` per §5.2).

---

## 9. Agent adapter impact (breaking, expected — PRD Q4)

`packages/adapters/src/casper-js-chain-client.ts` currently builds `distribute` args as `{ verdict_hashes, signers }` (trusted). SPEC-4 changes it to pass `signed_verdicts: Vec<SignedVerdict>` (CLValue list of structs). The agent (`servicer.ts`) **already collects `verdicts: SignedVerdict[]`** (line 121) and currently extracts `quorum.yesSigners` to discard the signatures — SPEC-4 passes the full signed verdicts through instead. Bounded, expected change.

---

## 10. Dashboard impact

`DistributionReceiptCard` (SPEC-1) gains a "signatures verified on-chain" affordance — render the `verifier_signatures` (signer + verdict + truncated sig) with a ShieldCheck, framed as "the contract verified each signature." Minimal; reuses the SPEC-1 component.

---

## 11. Tests (security matrix — the heart of SPEC-4)

| # | Case | Asserts |
|---|---|---|
| V1 | happy: 3 valid registered yes-sigs | distributes; Receipt carries 3 verified signatures |
| V2 | exact-quorum: 2 valid yes-sigs (quorum=2) | distributes |
| V3 | sub-quorum: 1 valid yes-sig | reverts `QuorumNotMet`; funds untouched; **no Receipt** |
| V4 | **forged signature** (sig doesn't match pubkey/message) | that verifier not counted; if it drops below quorum → revert |
| V5 | **replay** (sig bound to cycle "c1", distribute called for "c2") | skipped (bind check); not counted |
| V6 | **unregistered signer** (valid sig, pubkey not in registry) | skipped; not counted |
| V7 | **collusion attempt** (same pubkey signed twice) | counted once (distinct-verifier) |
| V8 | **no-sig path removed** (old trusted-`signers` call) | not callable — `distribute` now requires `signed_verdicts` |
| V9 | a "no" verdict signed validly | counted as a vote but not a yes; doesn't help quorum |
| V10 | Receipt's `signers` == the cryptographically verified set | provenance matches the gate |

V4–V7 are the security-critical cases — they prove the on-chain verification actually rejects attacks. All run under `cargo odra test` using the existing `vk(seed)` helper (derive SecretKey → sign → verify round-trip with real Ed25519).

---

## 12. Deploy note

Bundles with SPEC-1 (+ SPEC-6) — **one contract redeploy** (new hash → BUIDL-page update). SPEC-4 changes `distribute()`'s signature, so the agent + e2e harness must move to `signed_verdicts` before the on-chain smoke test.

---

## 13. Open questions (resolve at impl)

- **Q-sig-format:** confirm Casper's `Signature::from_bytes` accepts the raw Ed25519 signature bytes the TS `@noble/ed25519` produces (64 bytes). *(Lean: yes — both are raw Ed25519; the repo's x402 signing already round-trips Casper-format Ed25519, gotcha #3.)*
- **Q-adapter-encoding:** the CLValue encoding of `Vec<SignedVerdict>` (a list of structs) through `casper-js-sdk` v5 — confirm the struct CLType mapping in the adapter. *(Impl-time, against the existing `distribute` arg-encoding pattern.)*
- **Q-old-call-removal:** fully remove the `verdict_hashes`/`signers` params from `distribute`, or keep a deprecated shim? *(Lean: remove — clean break; the agent is the only caller.)*

---

## 14. Done checklist

- [ ] `core/sign.ts`: `canonicalBytes` (length-prefixed binary); sign/verify over bytes; `sign.test.ts` green.
- [ ] `SignedVerdict` on-chain type; `Receipt` extended with `verifier_signatures`.
- [ ] `distribute()` verifies each sig on-chain via `env().verify_signature`; counts valid distinct registered yes.
- [ ] Tests V1–V10 green under `cargo odra test` (V4–V7 are the security proofs).
- [ ] Agent adapter passes `signed_verdicts`; `servicer.test.ts` + e2e updated.
- [ ] Dashboard: "signatures verified on-chain" affordance.
- [ ] Full TS workspace + dashboard build green.
- [ ] (Bundled deploy) on-chain smoke: forged sig rejected, valid quorum distributes.

---

*Approve SPEC-4 to unlock implementation. The spike is GREEN; the design fixes the JSON-fragility at the root. After SPEC-4: SPEC-6 (verifier reputation — the unique moat).*
