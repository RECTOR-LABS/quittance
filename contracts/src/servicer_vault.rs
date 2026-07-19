//! `ServicerVault` — the on-chain core of Quittance.
//!
//! Custodies a per-asset distribution pool funded by a borrower's verified
//! cashflow and releases the entire pool to token holders **pro-rata** — but
//! only when a **quorum of registered verifiers cryptographically sign
//! yes-verdicts** that the cashflow arrived, and only **once per cycle**
//! (idempotent).
//!
//! Trust anchor (SPEC-4): `distribute()` verifies each Ed25519 verdict
//! signature **on-chain** via `env().verify_signature`. The servicer agent is
//! still the sole caller (operational), but it can no longer release funds by
//! listing trusted pubkeys — it must present ≥`quorum` valid, registered,
//! distinct-verifier **signed** yes-verdicts. "Verify, not attest" is now a
//! protocol property, not a demo claim.
//!
//! ABI note: `distribute` takes the per-verifier evidence as **parallel arrays**
//! (`signers`, `verdicts`, `signatures`, `observed_amounts`, `sources`) rather
//! than a `Vec<SignedVerdict>` struct. The verification logic is identical
//! (zip + verify each), but parallel arrays of primitives encode cleanly
//! through the SDK's `CLList` (Odra structs would require hand-serialized
//! heterogeneous byte layouts the SDK has no generic builder for).

use odra::casper_types::bytesrepr::Bytes;
use odra::casper_types::{PublicKey, U256, U512};
use odra::prelude::*;

/// Stored configuration for a registered asset.
#[odra::odra_type]
pub struct AssetConfig {
    /// Tokenized-asset / CEP-18 address (stored for provenance; not used for
    /// transfers in the qualifier — distribution pays native CSPR from the pool).
    pub token: Address,
    /// `(holder, relative_weight)` pairs. Weights are arbitrary positive
    /// integers; each holder receives `pool * weight / total_weight`.
    pub holders: Vec<(Address, U256)>,
    /// Registered verifier identities (e.g. 3).
    pub verifiers: Vec<PublicKey>,
    /// Required count of distinct registered signers (e.g. 2).
    pub quorum: u8,
}

/// Emitted on a successful distribution — the auditable on-chain record of the
/// settlement. `total` is the amount actually paid out (pool minus
/// integer-division dust). `signers` is the set of distinct, registered
/// verifiers whose **on-chain-verified** Ed25519 signatures satisfied the
/// quorum (SPEC-4). Anyone reading the log can re-check that ≥`quorum`
/// independent verifiers cryptographically attested before funds moved.
#[odra::event]
pub struct Distributed {
    pub asset_id: String,
    pub cycle_id: String,
    pub total: U512,
    /// Distinct registered verifiers whose **verified** signatures satisfied
    /// the quorum gate (SPEC-4).
    pub signers: Vec<PublicKey>,
}

/// Reverts surfaced by [`ServicerVault`]. Discriminants are stable on-chain
/// error codes; do not renumber.
#[odra::odra_error]
pub enum Error {
    /// No config registered for this `asset_id`.
    AssetNotFound = 1,
    /// `register_asset` called for an `asset_id` that already exists.
    AssetAlreadyExists = 2,
    /// `register_asset` called with an empty holder list.
    EmptyHolders = 3,
    /// `quorum == 0` or `quorum > verifiers.len()`.
    InvalidQuorum = 4,
    /// `distribute` already settled this `(asset_id, cycle_id)`.
    AlreadyDistributed = 5,
    /// Fewer than `quorum` distinct registered verifiers presented valid
    /// **signed** yes-verdicts (SPEC-4).
    QuorumNotMet = 6,
    /// The pool for this asset is empty (nothing funded for the cycle).
    InsufficientPool = 7,
    /// `register_asset` called with a non-empty holder list whose weights sum
    /// to zero (no holder can ever receive a share).
    ZeroTotalWeight = 8,
    /// The parallel evidence arrays disagree in length (SPEC-4).
    EvidenceArityMismatch = 9,
    /// `record_brief` called for a `(asset_id, cycle_id)` that already has a
    /// brief (SPEC-5). The first brief is final — narration is immutable.
    BriefAlreadyRecorded = 10,
    /// `record_brief` called for a cycle that has NOT been distributed (SPEC-5) —
    /// a brief may only anchor to a settled cycle (a receipt must exist).
    CycleNotSettled = 11,
    /// `record_brief` called with a brief over the 1024-byte cap (SPEC-5) —
    /// defends against a runaway LLM bloating on-chain state.
    BriefTooLong = 12,
    /// `record_brief` called by an account other than the registered servicer
    /// key (SPEC-5). The gate is operational (protects narration integrity, not
    /// funds); the servicer key is captured from the first `register_asset` caller.
    NotServicer = 13,
}

/// A cryptographically **verified** signature record, stored in the [`Receipt`]
/// as the on-chain quorum proof (SPEC-4).
#[odra::odra_type]
pub struct VerifierSignature {
    pub signer: PublicKey,
    pub verdict: bool,
    pub signature: Bytes,
}

/// On-chain reputation for one verifier (SPEC-6 — the unique moat). Auto-
/// created (zeroed) the first time a verifier is listed in any `register_asset`
/// call (verifiable on-chain identity from registration); accumulated inside
/// [`ServicerVault::distribute`] on every **successful** settlement. Global
/// across all assets — a verifier's reputation is its identity, not per-asset.
/// Read via [`ServicerVault::get_verifier_reputation`] /
/// [`ServicerVault::get_verifier_registry`].
///
/// Reputation is **informational** — it never gates fund release. The quorum
/// stays signature-based (SPEC-4). A compromised agent cannot inflate these
/// counts: they derive from the registered set + the verified signatures, not
/// from anything the agent reports. The only way to accumulate `cycles_agreed`
/// is to vote `yes` on a cycle that actually settles.
#[odra::odra_type]
pub struct VerifierReputation {
    pub pubkey: PublicKey,
    /// Times this verifier was registered for an asset whose cycle settled
    /// (the opportunity count). Incremented for every registered verifier on
    /// every successful distribute, responder or not.
    pub cycles_seen: u32,
    /// Times this verifier submitted a valid SPEC-4 signature for a settling
    /// cycle (the response count). `cycles_seen - cycles_voted` = non-response.
    pub cycles_voted: u32,
    /// Times this verifier's verdict was `yes` on a settling cycle (agreement
    /// with the outcome — on a settled cycle, `yes` is the accurate verdict).
    pub cycles_agreed: u32,
    /// Most recent verdict this verifier cast on a settling cycle
    /// (`true` = yes, `false` = no). `None` until first participation.
    pub last_verdict: Option<bool>,
    /// Most recent `"{asset_id}:{cycle_id}"` this verifier was scored on.
    pub last_cycle: Option<String>,
}

/// A pre-increment snapshot of a verifier's reputation, stored in the
/// [`Receipt`] (SPEC-6). Captures the track record each verifier **brought
/// to** a settlement — the basis on which a judge can evaluate the verifiers
/// *at the moment they voted*, not the post-hoc inflated counts.
#[odra::odra_type]
pub struct VerifierScoreSnapshot {
    pub signer: PublicKey,
    pub cycles_seen: u32,
    pub cycles_voted: u32,
    pub cycles_agreed: u32,
}

/// Stored on-chain receipt for a settled `(asset_id, cycle_id)` cycle — the
/// queryable mirror of the [`Distributed`] event (SPEC-1). Records the payout
/// totals plus the **cryptographically verified** quorum proof (distinct
/// registered signers + their verified signatures — SPEC-4). SPEC-5/6 extend
/// this struct with the AI brief hash and the reputation snapshot.
#[odra::odra_type]
pub struct Receipt {
    pub asset_id: String,
    pub cycle_id: String,
    /// Block time at settlement (ms since epoch, via `env().get_block_time()`).
    pub settled_at: u64,
    /// Amount actually paid out (== `Distributed::total`).
    pub total_distributed: U512,
    /// Integer-division dust retained in the pool (`pool - paid`).
    pub dust_retained: U512,
    /// Number of holders paid.
    pub holder_count: u32,
    /// Required distinct-signer count from `AssetConfig::quorum`.
    pub quorum_required: u8,
    /// Distinct registered verifiers whose **verified** yes-signatures
    /// satisfied the gate (SPEC-4).
    pub signers: Vec<PublicKey>,
    /// The verified signature records (the on-chain quorum proof, SPEC-4).
    pub verifier_signatures: Vec<VerifierSignature>,
    /// Pre-increment reputation snapshot per registered verifier (SPEC-6) —
    /// the track record each verifier brought to this settlement.
    pub reputation_snapshot: Vec<VerifierScoreSnapshot>,
}

#[odra::module(errors = Error, events = [Distributed])]
pub struct ServicerVault {
    /// `asset_id -> config`.
    assets: Mapping<String, AssetConfig>,
    /// `asset_id -> native CSPR balance held for distribution`.
    pools: Mapping<String, U512>,
    /// `"{asset_id}:{cycle_id}" -> true` once distributed (idempotency).
    ///
    /// Single colon-joined string key is **required** by the already-committed
    /// agent, which reads this dict via
    /// `queryDictItem(vaultHash, "distributed", `${assetId}:${cycleId}`)`.
    distributed: Mapping<String, bool>,
    /// `"{asset_id}:{cycle_id}" -> Receipt` once distributed (SPEC-1).
    ///
    /// Same colon-joined key as `distributed`; the queryable mirror of the
    /// [`Distributed`] event. Read via [`ServicerVault::get_receipt`].
    receipts: Mapping<String, Receipt>,
    /// `PublicKey -> VerifierReputation` (SPEC-6). Global across assets;
    /// auto-seeded from `register_asset`; accumulated in `distribute()` on
    /// every successful settlement. Read via [`Self::get_verifier_reputation`].
    verifier_registry: Mapping<PublicKey, VerifierReputation>,
    /// First-seen index of registry keys (SPEC-6) so [`Self::get_verifier_registry`]
    /// can iterate (Odra `Mapping` has no native iterate). Verifier counts are
    /// tiny (3 in the demo) so a `Var<Vec<PublicKey>>` index is the idiomatic
    /// pattern — a single stored CLValue holding the key list.
    verifier_keys: Var<Vec<PublicKey>>,
    /// `"{asset_id}:{cycle_id}" -> String` once a brief is recorded (SPEC-5).
    /// Same colon-joined key as `receipts`/`distributed`. The agent's per-cycle
    /// AI verification brief — a human-readable explanation of the
    /// cryptographically verified record. Written by `record_brief`
    /// (servicer-key-gated, idempotent, anchored to a settled cycle) after a
    /// successful distribute. Read via [`Self::get_brief`]. The brief is
    /// agent-attested narration, NOT cryptographic proof.
    briefs: Mapping<String, String>,
    /// The authorized servicer key (SPEC-5) — captured from the caller of the
    /// first `register_asset` (the asset registrar is the servicer in the
    /// single-operator demo). `record_brief` is gated to this key (operational
    /// only — protects narration integrity, never funds). Production would use
    /// proper governance; documented as a residual gap.
    servicer_key: Var<Address>,
}

#[odra::module]
impl ServicerVault {
    /// Register an asset and its distribution rules.
    ///
    /// Reverts [`Error::AssetAlreadyExists`], [`Error::EmptyHolders`],
    /// [`Error::ZeroTotalWeight`] (holders present but weights sum to zero),
    /// [`Error::InvalidQuorum`] (`quorum == 0` or `quorum > verifiers.len()`).
    pub fn register_asset(
        &mut self,
        asset_id: String,
        token: Address,
        holders: Vec<(Address, U256)>,
        verifiers: Vec<PublicKey>,
        quorum: u8,
    ) {
        if self.assets.get(&asset_id).is_some() {
            self.env().revert(Error::AssetAlreadyExists);
        }
        // SPEC-5: capture the servicer key from the first `register_asset`
        // caller (the asset registrar is the servicer in the single-operator
        // demo). `record_brief` is gated to this key (operational only).
        if self.servicer_key.get().is_none() {
            self.servicer_key.set(self.env().caller());
        }
        if holders.is_empty() {
            self.env().revert(Error::EmptyHolders);
        }
        let total_weight = holders
            .iter()
            .fold(U256::zero(), |acc, (_, weight)| acc + *weight);
        if total_weight.is_zero() {
            self.env().revert(Error::ZeroTotalWeight);
        }
        if quorum == 0 || quorum as usize > verifiers.len() {
            self.env().revert(Error::InvalidQuorum);
        }

        // SPEC-6: seed the global verifier registry with a zeroed entry for each
        // newly-seen verifier pubkey (verifiable on-chain identity from
        // registration — Casper example-#2). Done BEFORE `assets.set` moves the
        // `verifiers` vec, so we iterate it by reference here. A verifier listed
        // by multiple assets keeps one accumulating entry (idempotent seed).
        for v in &verifiers {
            if self.verifier_registry.get(v).is_none() {
                self.verifier_registry.set(
                    v,
                    VerifierReputation {
                        pubkey: v.clone(),
                        cycles_seen: 0,
                        cycles_voted: 0,
                        cycles_agreed: 0,
                        last_verdict: None,
                        last_cycle: None,
                    },
                );
                let mut keys = self.verifier_keys.get_or_default();
                keys.push(v.clone());
                self.verifier_keys.set(keys);
            }
        }

        self.assets.set(
            &asset_id,
            AssetConfig {
                token,
                holders,
                verifiers,
                quorum,
            },
        );
    }

    /// Read an asset's config. Reverts [`Error::AssetNotFound`] if absent.
    pub fn get_asset(&self, asset_id: String) -> AssetConfig {
        self.assets
            .get(&asset_id)
            .unwrap_or_revert_with(self, Error::AssetNotFound)
    }

    /// Read the pool balance for an asset (`0` if none).
    pub fn pool_of(&self, asset_id: String) -> U512 {
        self.pools.get_or_default(&asset_id)
    }

    /// Read the stored receipt for a settled `(asset_id, cycle_id)` cycle
    /// (SPEC-1), or `None` if that cycle has not been distributed yet.
    /// Read-only; no caller gate; no revert.
    pub fn get_receipt(&self, asset_id: String, cycle_id: String) -> Option<Receipt> {
        let key = format!("{asset_id}:{cycle_id}");
        self.receipts.get(&key)
    }

    /// Read one verifier's on-chain reputation (SPEC-6). `None` if the pubkey
    /// was never registered. Read-only; no caller gate; no revert.
    pub fn get_verifier_reputation(&self, pubkey: PublicKey) -> Option<VerifierReputation> {
        self.verifier_registry.get(&pubkey)
    }

    /// Read the full verifier registry (SPEC-6) — every verifier ever
    /// authorized across all assets, with its accumulated track record, in
    /// first-seen (registration) order. The dashboard renders the reputation
    /// panel from this. Read-only; no caller gate; no revert.
    pub fn get_verifier_registry(&self) -> Vec<VerifierReputation> {
        self.verifier_keys
            .get_or_default()
            .iter()
            .filter_map(|pk| self.verifier_registry.get(pk))
            .collect()
    }

    /// Record the agent's per-cycle AI verification brief (SPEC-5). The brief is
    /// a human-readable explanation of the cryptographically verified record —
    /// agent-attested narration, NOT cryptographic proof (the verifiable truth
    /// is the on-chain signatures + reputation, SPEC-4/6).
    ///
    /// Gates (all operational — protect narration integrity, never funds):
    /// (a) caller == registered servicer key else [`Error::NotServicer`];
    /// (b) a receipt must exist for this cycle else [`Error::CycleNotSettled`]
    ///     (a brief anchors to a settled cycle — no brief for halts);
    /// (c) idempotent — first brief is final else [`Error::BriefAlreadyRecorded`];
    /// (d) `brief.len() <= 1024` else [`Error::BriefTooLong`] (state-bloat defense).
    pub fn record_brief(&mut self, asset_id: String, cycle_id: String, brief: String) {
        // (a) operational gate — only the servicer may write narration.
        let servicer = self
            .servicer_key
            .get()
            .unwrap_or_revert_with(self, Error::NotServicer);
        if self.env().caller() != servicer {
            self.env().revert(Error::NotServicer);
        }
        let key = format!("{asset_id}:{cycle_id}");
        // (b) anchor — a brief may only be recorded for a settled cycle.
        if self.receipts.get(&key).is_none() {
            self.env().revert(Error::CycleNotSettled);
        }
        // (c) idempotent — first brief is final.
        if self.briefs.get(&key).is_some() {
            self.env().revert(Error::BriefAlreadyRecorded);
        }
        // (d) cap — defend against a runaway LLM bloating on-chain state.
        if brief.len() > 1024 {
            self.env().revert(Error::BriefTooLong);
        }
        self.briefs.set(&key, brief);
    }

    /// Read the agent's per-cycle AI verification brief (SPEC-5), or `None` if
    /// no brief was recorded for this cycle (e.g. a halted cycle, or one where
    /// the LLM call failed post-settle). Read-only; no caller gate; no revert.
    pub fn get_brief(&self, asset_id: String, cycle_id: String) -> Option<String> {
        let key = format!("{asset_id}:{cycle_id}");
        self.briefs.get(&key)
    }

    /// Add attached CSPR to `pools[asset_id]`.
    ///
    /// Reverts [`Error::AssetNotFound`] if the asset is not registered.
    #[odra(payable)]
    pub fn fund(&mut self, asset_id: String) {
        if self.assets.get(&asset_id).is_none() {
            self.env().revert(Error::AssetNotFound);
        }
        let attached = self.env().attached_value();
        let current = self.pools.get_or_default(&asset_id);
        self.pools.set(&asset_id, current + attached);
    }

    /// Release the pool to holders pro-rata, once per `(asset_id, cycle_id)`.
    ///
    /// The quorum is enforced **on-chain** (SPEC-4): each per-verifier evidence
    /// tuple (signers[i], verdicts[i], signatures[i], observed_amounts[i],
    /// sources[i]) is verified via `env().verify_signature` over
    /// [`canonical_bytes`] built from the distribute's `(asset_id, cycle_id)`
    /// plus the tuple's verdict/observed/source. Only valid, registered, bound,
    /// distinct-verifier **yes** signatures count toward `quorum`. The servicer
    /// key alone cannot release funds — it must present ≥`quorum` valid signed
    /// yes-verdicts. The verified signer set + signatures are recorded in the
    /// [`Distributed`] event and the stored [`Receipt`].
    ///
    /// The five evidence arrays must be the same length (one entry per
    /// verifier); else [`Error::EvidenceArityMismatch`].
    pub fn distribute(
        &mut self,
        asset_id: String,
        cycle_id: String,
        signers: Vec<PublicKey>,
        verdicts: Vec<bool>,
        signatures: Vec<Bytes>,
        observed_amounts: Vec<String>,
        sources: Vec<String>,
    ) {
        // 0. Evidence arrays must be parallel (one entry per verifier).
        let n = signers.len();
        if verdicts.len() != n
            || signatures.len() != n
            || observed_amounts.len() != n
            || sources.len() != n
        {
            self.env().revert(Error::EvidenceArityMismatch);
        }

        // 1. Asset must be registered.
        let cfg = self
            .assets
            .get(&asset_id)
            .unwrap_or_revert_with(self, Error::AssetNotFound);

        // 2. Idempotency: bail before touching the pool or transferring.
        let key = format!("{asset_id}:{cycle_id}");
        if self.distributed.get_or_default(&key) {
            self.env().revert(Error::AlreadyDistributed);
        }

        // 3. Quorum gate — ON-CHAIN SIGNATURE VERIFICATION (SPEC-4).
        //
        // TRUST BOUNDARY (post-SPEC-4): the contract verifies each Ed25519
        // signature over `canonical_bytes(asset_id, cycle_id, verdict, observed,
        // source)` via `env().verify_signature`. A verdict counts toward the
        // quorum only if it is:
        //   (a) BOUND — the canonical message embeds `asset_id`/`cycle_id` from
        //       THIS distribute call, so a cycle-c1 signature cannot release
        //       cycle-c2 (replay protection L4).
        //   (b) REGISTERED — `signer` is in the asset's verifier registry.
        //   (c) DISTINCT — one vote per pubkey (anti-collusion by construction).
        //   (d) VALID — the signature cryptographically verifies on-chain.
        //   (e) YES — only affirmative verdicts count toward the quorum.
        // The servicer key alone (without ≥quorum valid signed yes-verdicts)
        // cannot release funds. Forged/replayed/unregistered signatures are
        // silently rejected (not counted); if the valid yes-count is below
        // quorum, `distribute` reverts `QuorumNotMet` and nothing moves.
        let mut verified_signers: Vec<PublicKey> = Vec::new();
        let mut verified_sigs: Vec<VerifierSignature> = Vec::new();
        // SPEC-6: every distinct verified signer + its verdict (yes OR no), for
        // reputation scoring. `verified_signers` (yes-only) stays the quorum /
        // event / receipt-signers set; this superset feeds the per-verifier
        // score. Deduped on `seen_verified` (first-seen-wins) — a superset of
        // the yes-only dedup, so the SPEC-4 V1–V10 behavior is unchanged.
        let mut seen_verified: Vec<PublicKey> = Vec::new();
        let mut verified_with_verdict: Vec<(PublicKey, bool)> = Vec::new();
        for i in 0..n {
            let signer = &signers[i];
            // (b) REGISTERED.
            if !cfg.verifiers.contains(signer) {
                continue;
            }
            // (c) DISTINCT — one verified vote per pubkey.
            if seen_verified.contains(signer) {
                continue;
            }
            // (d) VALID — Ed25519 verify on-chain over the canonical bytes
            //     bound to this (asset_id, cycle_id) + the tuple's fields.
            let message = canonical_bytes(
                &asset_id,
                &cycle_id,
                verdicts[i],
                &observed_amounts[i],
                &sources[i],
            );
            if !self
                .env()
                .verify_signature(&message, &signatures[i], signer)
            {
                continue;
            }
            seen_verified.push(signer.clone());
            // SPEC-6: record the verified verdict (yes OR no) for scoring.
            verified_with_verdict.push((signer.clone(), verdicts[i]));
            // (e) YES — only affirmative verdicts count toward the quorum.
            if verdicts[i] {
                verified_signers.push(signer.clone());
                verified_sigs.push(VerifierSignature {
                    signer: signer.clone(),
                    verdict: true,
                    signature: signatures[i].clone(),
                });
            }
        }
        if verified_signers.len() < cfg.quorum as usize {
            self.env().revert(Error::QuorumNotMet);
        }

        // 4. Pool must be funded for this cycle.
        let pool = self.pools.get_or_default(&asset_id);
        if pool.is_zero() {
            self.env().revert(Error::InsufficientPool);
        }

        // 5. Pay each holder `pool * weight / total_weight` (integer division).
        let total_weight: U512 = cfg
            .holders
            .iter()
            .fold(U512::zero(), |acc, (_, weight)| acc + to_u512(weight));
        if total_weight.is_zero() {
            self.env().revert(Error::ZeroTotalWeight);
        }

        let mut paid = U512::zero();
        for (holder, weight) in cfg.holders.iter() {
            let amount = pool * to_u512(weight) / total_weight;
            if amount.is_zero() {
                continue;
            }
            self.env().transfer_tokens(holder, &amount);
            paid += amount;
        }

        // 6. Retain integer-division dust (`pool - paid >= 0` by construction).
        self.pools.set(&asset_id, pool - paid);

        // 7. Mark this cycle settled.
        self.distributed.set(&key, true);

        // 7b. SPEC-6 — on-chain verifier reputation: snapshot (pre-increment)
        //     then score every registered verifier, then store the receipt with
        //     the snapshot. Reputation is informational (never gates release);
        //     the only way to accumulate `cycles_agreed` is to vote `yes` on a
        //     cycle that actually settles. Non-responders get `cycles_seen` only.
        //
        //     Distinct registered verifiers (`cfg.verifiers` may contain dupes;
        //     score each verifier once, first-seen order).
        let mut unique_verifiers: Vec<PublicKey> = Vec::new();
        for v in &cfg.verifiers {
            if !unique_verifiers.contains(v) {
                unique_verifiers.push(v.clone());
            }
        }
        // (1) SNAPSHOT — the track record each verifier brought to this cycle
        //     (pre-increment), so a receipt shows the basis on which the
        //     verifiers can be evaluated *at the moment they voted*.
        let reputation_snapshot: Vec<VerifierScoreSnapshot> = unique_verifiers
            .iter()
            .map(|v| {
                let rep = self.verifier_registry.get(v).unwrap_or_else(|| {
                    VerifierReputation {
                        pubkey: v.clone(),
                        cycles_seen: 0,
                        cycles_voted: 0,
                        cycles_agreed: 0,
                        last_verdict: None,
                        last_cycle: None,
                    }
                });
                VerifierScoreSnapshot {
                    signer: v.clone(),
                    cycles_seen: rep.cycles_seen,
                    cycles_voted: rep.cycles_voted,
                    cycles_agreed: rep.cycles_agreed,
                }
            })
            .collect();
        // (2) SCORE — increment each registered verifier. A verifier that
        //     submitted a verified signature (yes or no) is a responder; a
        //     `yes` on a settling cycle is an agreement.
        for v in &unique_verifiers {
            let mut rep = self.verifier_registry.get(v).unwrap_or_else(|| {
                VerifierReputation {
                    pubkey: v.clone(),
                    cycles_seen: 0,
                    cycles_voted: 0,
                    cycles_agreed: 0,
                    last_verdict: None,
                    last_cycle: None,
                }
            });
            rep.cycles_seen += 1;
            if let Some((_, verdict)) = verified_with_verdict.iter().find(|(p, _)| *p == *v) {
                rep.cycles_voted += 1;
                rep.last_verdict = Some(*verdict);
                rep.last_cycle = Some(key.clone());
                if *verdict {
                    rep.cycles_agreed += 1;
                }
            }
            self.verifier_registry.set(v, rep);
        }

        // 7c. Store the queryable receipt (SPEC-1) — now carrying the
        //     cryptographically verified quorum proof (SPEC-4) + the
        //     pre-increment reputation snapshot (SPEC-6).
        self.receipts.set(
            &key,
            Receipt {
                asset_id: asset_id.clone(),
                cycle_id: cycle_id.clone(),
                settled_at: self.env().get_block_time(),
                total_distributed: paid,
                dust_retained: pool - paid,
                holder_count: cfg.holders.len() as u32,
                quorum_required: cfg.quorum,
                signers: verified_signers.clone(),
                verifier_signatures: verified_sigs.clone(),
                reputation_snapshot,
            },
        );

        // 8. Emit the auditable record: settled totals plus the verified
        //    signer set, so anyone reading the log can re-check that
        //    >=2 independent verifiers *cryptographically* attested before
        //    funds moved.
        self.env().emit_event(Distributed {
            asset_id,
            cycle_id,
            total: paid,
            signers: verified_signers,
        });
    }
}

/// Reconstruct the canonical signed bytes for one verdict (SPEC-4 §4).
///
/// Layout (u16 big-endian length prefixes; verdict is a single byte):
///   `[u16 asset_id.len] asset_id_utf8`
///   `[u16 cycle_id.len] cycle_id_utf8`
///   `[0x01 if verdict else 0x00]`
///   `[u16 observed_amount.len] observed_amount_utf8`
///   `[u16 source.len] source_utf8`
///
/// Binary (not JSON) so the off-chain signer (`core/sign.ts :: canonicalBytes`)
/// and this on-chain reconstruction agree byte-for-byte — no fragile
/// cross-language string-matching. Ed25519 signs the raw bytes directly
/// (no host hash call needed).
fn canonical_bytes(
    asset_id: &str,
    cycle_id: &str,
    verdict: bool,
    observed_amount: &str,
    source: &str,
) -> Bytes {
    let mut out: Vec<u8> = Vec::new();
    push_str(&mut out, asset_id);
    push_str(&mut out, cycle_id);
    out.push(if verdict { 1 } else { 0 });
    push_str(&mut out, observed_amount);
    push_str(&mut out, source);
    Bytes::from(out)
}

/// Append a u16-big-endian length-prefixed UTF-8 field to `out` (canonical-bytes
/// helper, SPEC-4 §4). Free function (not a closure) so it doesn't hold a
/// borrow across the verdict-byte push in [`canonical_bytes`].
fn push_str(out: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    let len = b.len() as u16;
    out.push((len >> 8) as u8);
    out.push((len & 0xff) as u8);
    out.extend_from_slice(b);
}

/// Lossless widening of a holder weight (`U256`) to the native-amount domain
/// (`U512`) via little-endian bytes. A `U256` always fits in 32 bytes, which
/// `U512::from_little_endian` zero-extends.
fn to_u512(value: &U256) -> U512 {
    let mut buf = [0u8; 32];
    value.to_little_endian(&mut buf);
    U512::from_little_endian(&buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::casper_types::bytesrepr::ToBytes;
    use odra::casper_types::crypto::sign as ed25519_sign;
    use odra::casper_types::SecretKey;
    use odra::host::{Deployer, HostEnv, HostRef, NoArgs};

    // ---- helpers -------------------------------------------------------------

    /// Deterministic, distinct ed25519 verifier key from a single-byte seed.
    fn vk(seed: u8) -> PublicKey {
        let sk = SecretKey::ed25519_from_bytes([seed; 32])
            .expect("32-byte ed25519 seed is always valid");
        PublicKey::from(&sk)
    }

    /// Sign one verdict with the seed-derived key; returns `(signer_pubkey,
    /// signature_bytes)` where the signature is a valid Casper `Signature`
    /// (`[0x01, <64 bytes>]`) over `canonical_bytes(asset, cycle, verdict,
    /// observed, source)` — exactly what a real off-chain verifier
    /// (`core/sign.ts :: signVerdict`) produces, so the on-chain
    /// `verify_signature` accepts it.
    fn sign_one(
        seed: u8,
        asset_id: &str,
        cycle_id: &str,
        verdict: bool,
        observed: &str,
        source: &str,
    ) -> (PublicKey, Bytes) {
        let sk = SecretKey::ed25519_from_bytes([seed; 32])
            .expect("32-byte ed25519 seed is always valid");
        let pk = PublicKey::from(&sk);
        let message = canonical_bytes(asset_id, cycle_id, verdict, observed, source);
        let signature = ed25519_sign(message.as_slice(), &sk, &pk);
        let signature_bytes = Bytes::from(signature.to_bytes().expect("signature serializes"));
        (pk, signature_bytes)
    }

    /// Build the five parallel evidence arrays for `distribute` from a list of
    /// `(seed, verdict, observed, source)` specs — each verdict signed by its
    /// seed key over `(asset_id, cycle_id, ...)`.
    fn signed_arrays(
        asset_id: &str,
        cycle_id: &str,
        specs: &[(u8, bool, &str, &str)],
    ) -> (Vec<PublicKey>, Vec<bool>, Vec<Bytes>, Vec<String>, Vec<String>) {
        let mut signers = Vec::new();
        let mut verdicts = Vec::new();
        let mut signatures = Vec::new();
        let mut observed_amounts = Vec::new();
        let mut sources = Vec::new();
        for &(seed, verdict, observed, source) in specs {
            let (pk, sig) = sign_one(seed, asset_id, cycle_id, verdict, observed, source);
            signers.push(pk);
            verdicts.push(verdict);
            signatures.push(sig);
            observed_amounts.push(observed.to_string());
            sources.push(source.to_string());
        }
        (signers, verdicts, signatures, observed_amounts, sources)
    }

    /// Assert a `try_*` result reverted with the given contract error.
    fn assert_revert<T: core::fmt::Debug>(res: OdraResult<T>, expected: Error) {
        let expected_code = expected as u16;
        match res {
            Ok(v) => panic!("expected revert code {}, got Ok({:?})", expected_code, v),
            Err(err) => assert_eq!(
                err.code(),
                expected_code,
                "expected error code {}, got {:?}",
                expected_code,
                err
            ),
        }
    }

    /// A standard 3-verifier, 2-holder, quorum-2 asset funded with 1000 motes.
    /// Uses the caller's `env` (OdraVM envs are per-call). Returns
    /// `(vault, alice, bob)` ready for a distribute call.
    fn funded_vault(env: &HostEnv) -> (ServicerVaultHostRef, Address, Address) {
        let token = env.get_account(0);
        let alice = env.get_account(1);
        let bob = env.get_account(2);
        let mut vault = ServicerVault::deploy(env, NoArgs);
        vault.register_asset(
            "inv-1".to_string(),
            token,
            vec![(alice, U256::from(700)), (bob, U256::from(300))],
            vec![vk(1), vk(2), vk(3)],
            2,
        );
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());
        (vault, alice, bob)
    }

    /// The standard 3-verifier happy evidence (vk1+vk2+vk3 all YES) for cycle c1.
    fn happy_evidence() -> (Vec<PublicKey>, Vec<bool>, Vec<Bytes>, Vec<String>, Vec<String>) {
        signed_arrays(
            "inv-1",
            "c1",
            &[
                (1, true, "1000", "bank-api"),
                (2, true, "1000", "stripe"),
                (3, true, "1000", "ledger"),
            ],
        )
    }

    // ---- registration / funding (unchanged behavior) -----------------------

    // 1. register + get
    #[test]
    fn register_then_get_reflects_config() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let alice = env.get_account(1);
        let bob = env.get_account(2);
        let mut vault = ServicerVault::deploy(&env, NoArgs);

        vault.register_asset(
            "inv-1".to_string(),
            token,
            vec![(alice, U256::from(700)), (bob, U256::from(300))],
            vec![vk(1), vk(2), vk(3)],
            2,
        );

        let cfg = vault.get_asset("inv-1".to_string());
        assert_eq!(cfg.quorum, 2);
        assert_eq!(cfg.holders.len(), 2);
        assert_eq!(cfg.verifiers.len(), 3);
        assert_eq!(cfg.token, token);
    }

    // 2. register rejects empty holders
    #[test]
    fn register_rejects_empty_holders() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let mut vault = ServicerVault::deploy(&env, NoArgs);

        let res = vault.try_register_asset(
            "inv-1".to_string(),
            token,
            vec![],
            vec![vk(1), vk(2), vk(3)],
            2,
        );
        assert_revert(res, Error::EmptyHolders);
    }

    // 3. register rejects quorum 0 and quorum > verifiers (two cases)
    #[test]
    fn register_rejects_quorum_zero() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let alice = env.get_account(1);
        let mut vault = ServicerVault::deploy(&env, NoArgs);

        let res = vault.try_register_asset(
            "inv-1".to_string(),
            token,
            vec![(alice, U256::from(1))],
            vec![vk(1), vk(2), vk(3)],
            0,
        );
        assert_revert(res, Error::InvalidQuorum);
    }

    #[test]
    fn register_rejects_quorum_above_verifier_count() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let alice = env.get_account(1);
        let mut vault = ServicerVault::deploy(&env, NoArgs);

        let res = vault.try_register_asset(
            "inv-1".to_string(),
            token,
            vec![(alice, U256::from(1))],
            vec![vk(1), vk(2)],
            3,
        );
        assert_revert(res, Error::InvalidQuorum);
    }

    // 3b. register rejects non-empty holders whose weights all sum to zero
    #[test]
    fn register_rejects_zero_total_weight() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let alice = env.get_account(1);
        let bob = env.get_account(2);
        let mut vault = ServicerVault::deploy(&env, NoArgs);

        let res = vault.try_register_asset(
            "inv-1".to_string(),
            token,
            vec![(alice, U256::zero()), (bob, U256::zero())],
            vec![vk(1), vk(2), vk(3)],
            2,
        );
        assert_revert(res, Error::ZeroTotalWeight);
    }

    // 4. register rejects duplicate asset_id
    #[test]
    fn register_rejects_duplicate_asset_id() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let alice = env.get_account(1);
        let mut vault = ServicerVault::deploy(&env, NoArgs);

        vault.register_asset(
            "inv-1".to_string(),
            token,
            vec![(alice, U256::from(1))],
            vec![vk(1), vk(2), vk(3)],
            2,
        );

        let res = vault.try_register_asset(
            "inv-1".to_string(),
            token,
            vec![(alice, U256::from(1))],
            vec![vk(1), vk(2), vk(3)],
            2,
        );
        assert_revert(res, Error::AssetAlreadyExists);
    }

    // 5. fund increases pool; funding unregistered asset reverts AssetNotFound
    #[test]
    fn fund_increases_pool_and_rejects_unregistered() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let alice = env.get_account(1);
        let mut vault = ServicerVault::deploy(&env, NoArgs);

        vault.register_asset(
            "inv-1".to_string(),
            token,
            vec![(alice, U256::from(1))],
            vec![vk(1), vk(2), vk(3)],
            2,
        );

        assert_eq!(vault.pool_of("inv-1".to_string()), U512::zero());
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::from(1000));

        let res = vault
            .with_tokens(U512::from(500))
            .try_fund("nope".to_string());
        assert_revert(res, Error::AssetNotFound);
    }

    // ---- distribute (SPEC-4: on-chain signature verification) -------------

    // V1. happy: 3 valid registered yes-sigs -> distributes; Receipt carries
    // 3 verified signatures.
    #[test]
    fn distribute_pays_pro_rata_and_emits_event() {
        let env = odra_test::env();
        let (mut vault, alice, bob) = funded_vault(&env);
        let alice_before = env.balance_of(&alice);
        let bob_before = env.balance_of(&bob);

        let (signers, verdicts, sigs, obs, src) = happy_evidence();
        vault.distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            signers,
            verdicts,
            sigs,
            obs,
            src,
        );

        assert_eq!(env.balance_of(&alice) - alice_before, U512::from(700));
        assert_eq!(env.balance_of(&bob) - bob_before, U512::from(300));
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::zero());

        let event: Distributed = env.get_event(&vault, 0).expect("Distributed event");
        assert_eq!(event.asset_id, "inv-1");
        assert_eq!(event.cycle_id, "c1");
        assert_eq!(event.total, U512::from(1000));
        assert_eq!(event.signers, vec![vk(1), vk(2), vk(3)]);

        let receipt = vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .expect("receipt");
        assert_eq!(receipt.signers, vec![vk(1), vk(2), vk(3)]);
        assert_eq!(receipt.verifier_signatures.len(), 3);
        // V10: Receipt.signers == cryptographically verified set.
        assert_eq!(receipt.signers, event.signers);
    }

    // V2. exact-quorum (2 valid yes-sigs, quorum=2) -> distributes.
    #[test]
    fn distribute_exact_quorum_distributes() {
        let env = odra_test::env();
        let (mut vault, alice, _bob) = funded_vault(&env);
        let alice_before = env.balance_of(&alice);

        let (signers, verdicts, sigs, obs, src) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            signers,
            verdicts,
            sigs,
            obs,
            src,
        );
        assert_eq!(env.balance_of(&alice) - alice_before, U512::from(700));
    }

    // V3. sub-quorum (1 valid yes-sig) -> QuorumNotMet; funds untouched; no Receipt.
    #[test]
    fn distribute_reverts_under_quorum_and_preserves_state() {
        let env = odra_test::env();
        let (mut vault, alice, bob) = funded_vault(&env);
        let alice_before = env.balance_of(&alice);
        let bob_before = env.balance_of(&bob);

        let (signers, verdicts, sigs, obs, src) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api")]); // 1 < quorum 2
        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            signers,
            verdicts,
            sigs,
            obs,
            src,
        );
        assert_revert(res, Error::QuorumNotMet);

        assert_eq!(env.balance_of(&alice), alice_before);
        assert_eq!(env.balance_of(&bob), bob_before);
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::from(1000));
        // No phantom receipt on the fraud/halt path.
        assert!(vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .is_none());
    }

    // V4. FORGED SIGNATURE — sig doesn't match the signer pubkey -> not counted;
    // below quorum -> QuorumNotMet (the security proof).
    #[test]
    fn distribute_rejects_forged_signature() {
        let env = odra_test::env();
        let (mut vault, alice, _bob) = funded_vault(&env);
        let alice_before = env.balance_of(&alice);

        // Sign the c1 verdict with vk(2)'s key, but claim vk(1) as the signer,
        // so the on-chain verify against vk(1) fails.
        let (forged_pk_unused, forged_sig) = sign_one(2, "inv-1", "c1", true, "1000", "bank-api");
        let _ = forged_pk_unused;
        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![vk(1)], // claim vk(1) as signer
            vec![true],
            vec![forged_sig], // but the sig was made by vk(2)
            vec!["1000".to_string()],
            vec!["bank-api".to_string()],
        );
        assert_revert(res, Error::QuorumNotMet);
        assert_eq!(env.balance_of(&alice), alice_before);
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::from(1000));
    }

    // V5. REPLAY — a signature bound to cycle "c1" cannot release cycle "c2".
    #[test]
    fn distribute_rejects_replayed_signature() {
        let env = odra_test::env();
        let (mut vault, alice, _bob) = funded_vault(&env);
        let alice_before = env.balance_of(&alice);

        // Sign a verdict for cycle "c1", but call distribute for cycle "c2".
        // The contract rebuilds the canonical message with c2, so the c1-sig
        // does not verify -> rejected.
        let (replay_pk, replay_sig) = sign_one(1, "inv-1", "c1", true, "1000", "bank-api");
        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c2".to_string(), // different cycle
            vec![replay_pk],
            vec![true],
            vec![replay_sig],
            vec!["1000".to_string()],
            vec!["bank-api".to_string()],
        );
        assert_revert(res, Error::QuorumNotMet);
        assert_eq!(env.balance_of(&alice), alice_before);
    }

    // V6. UNREGISTERED SIGNER — valid sig, but pubkey not in the registry.
    #[test]
    fn distribute_ignores_unregistered_signer() {
        let env = odra_test::env();
        let (mut vault, alice, _bob) = funded_vault(&env);
        let alice_before = env.balance_of(&alice);

        // vk(99) is not in the registered set {vk(1), vk(2), vk(3)}.
        let (signers, verdicts, sigs, obs, src) =
            signed_arrays("inv-1", "c1", &[(99, true, "1000", "bank-api")]);
        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            signers,
            verdicts,
            sigs,
            obs,
            src,
        );
        assert_revert(res, Error::QuorumNotMet);
        assert_eq!(env.balance_of(&alice), alice_before);
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::from(1000));
    }

    // V7. COLLUSION — the same pubkey signed twice counts once.
    #[test]
    fn distribute_dedups_doubled_signer() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);

        let (s1, v1, sig1, o1, sr1) = signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api")]);
        // Submit the same (signer, sig) twice — one distinct signer, twice.
        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![s1[0].clone(), s1[0].clone()],
            vec![v1[0], v1[0]],
            vec![sig1[0].clone(), sig1[0].clone()],
            vec![o1[0].clone(), o1[0].clone()],
            vec![sr1[0].clone(), sr1[0].clone()],
        );
        assert_revert(res, Error::QuorumNotMet);
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::from(1000));
    }

    // V8. NO BACK DOOR — empty evidence reverts QuorumNotMet.
    #[test]
    fn distribute_with_no_signatures_reverts() {
        let env = odra_test::env();
        let (mut vault, alice, _bob) = funded_vault(&env);
        let alice_before = env.balance_of(&alice);

        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![],
            vec![],
            vec![],
            vec![],
            vec![],
        );
        assert_revert(res, Error::QuorumNotMet);
        assert_eq!(env.balance_of(&alice), alice_before);
    }

    // V9. a validly-signed "no" verdict is verified but doesn't help quorum.
    #[test]
    fn distribute_counts_no_verdict_but_it_does_not_satisfy_quorum() {
        let env = odra_test::env();
        let (mut vault, alice, _bob) = funded_vault(&env);
        let alice_before = env.balance_of(&alice);

        // One yes + one validly-signed no: only the yes counts (1 < quorum 2).
        let (signers, verdicts, sigs, obs, src) = signed_arrays(
            "inv-1",
            "c1",
            &[(1, true, "1000", "bank-api"), (2, false, "0", "bank-api")],
        );
        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            signers,
            verdicts,
            sigs,
            obs,
            src,
        );
        assert_revert(res, Error::QuorumNotMet);
        assert_eq!(env.balance_of(&alice), alice_before);
    }

    // 10. distribute idempotent per cycle
    #[test]
    fn distribute_is_idempotent_per_cycle() {
        let env = odra_test::env();
        let (mut vault, alice, bob) = funded_vault(&env);

        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);

        let alice_after_first = env.balance_of(&alice);
        let bob_after_first = env.balance_of(&bob);

        // Second call, same (asset, cycle) -> AlreadyDistributed, no payment.
        let (s2, v2, sg2, o2, sr2) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        let res = vault.try_distribute("inv-1".to_string(), "c1".to_string(), s2, v2, sg2, o2, sr2);
        assert_revert(res, Error::AlreadyDistributed);
        assert_eq!(env.balance_of(&alice), alice_after_first);
        assert_eq!(env.balance_of(&bob), bob_after_first);

        // A different cycle, after re-funding, distributes normally.
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());
        let (s3, v3, sg3, o3, sr3) =
            signed_arrays("inv-1", "c2", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c2".to_string(), s3, v3, sg3, o3, sr3);
        assert_eq!(env.balance_of(&alice) - alice_after_first, U512::from(700));
        assert_eq!(env.balance_of(&bob) - bob_after_first, U512::from(300));
    }

    // 11. distribute reverts on empty pool
    #[test]
    fn distribute_reverts_on_empty_pool() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let alice = env.get_account(1);
        let bob = env.get_account(2);
        let mut vault = ServicerVault::deploy(&env, NoArgs);

        vault.register_asset(
            "inv-1".to_string(),
            token,
            vec![(alice, U256::from(700)), (bob, U256::from(300))],
            vec![vk(1), vk(2), vk(3)],
            2,
        );
        // No fund() -> pool is zero.

        let alice_before = env.balance_of(&alice);
        let bob_before = env.balance_of(&bob);

        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        let res = vault.try_distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);
        assert_revert(res, Error::InsufficientPool);
        assert_eq!(env.balance_of(&alice), alice_before);
        assert_eq!(env.balance_of(&bob), bob_before);
    }

    // 12. dust is carried, not lost
    #[test]
    fn distribute_carries_integer_division_dust() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let a = env.get_account(1);
        let b = env.get_account(2);
        let c = env.get_account(3);
        let mut vault = ServicerVault::deploy(&env, NoArgs);

        vault.register_asset(
            "inv-1".to_string(),
            token,
            vec![(a, U256::from(1)), (b, U256::from(1)), (c, U256::from(1))],
            vec![vk(1), vk(2), vk(3)],
            2,
        );
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());

        let a_before = env.balance_of(&a);
        let b_before = env.balance_of(&b);
        let c_before = env.balance_of(&c);

        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);

        assert_eq!(env.balance_of(&a) - a_before, U512::from(333));
        assert_eq!(env.balance_of(&b) - b_before, U512::from(333));
        assert_eq!(env.balance_of(&c) - c_before, U512::from(333));
        // 1000 - 999 = 1 dust retained, nothing burned.
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::from(1));

        let event: Distributed = env.get_event(&vault, 0).expect("Distributed event");
        assert_eq!(event.total, U512::from(999));
        // Quorum proof recorded even when dust is carried.
        assert_eq!(event.signers, vec![vk(1), vk(2)]);
    }

    // ---- SPEC-1: queryable on-chain receipts (R1–R6, adapted to SPEC-4) ----

    // R1. get_receipt returns None before distribute.
    #[test]
    fn get_receipt_none_before_distribute() {
        let env = odra_test::env();
        let (vault, _alice, _bob) = funded_vault(&env);
        // Funded + registered but NOT distributed -> no receipt yet.
        assert!(vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .is_none());
    }

    // R2. after happy distribute, get_receipt mirrors the event.
    #[test]
    fn get_receipt_mirrors_event_after_distribute() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);

        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);

        let receipt = vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .expect("receipt after distribute");
        assert_eq!(receipt.asset_id, "inv-1");
        assert_eq!(receipt.cycle_id, "c1");
        assert_eq!(receipt.total_distributed, U512::from(1000));
        assert_eq!(receipt.dust_retained, U512::zero());
        assert_eq!(receipt.holder_count, 2);
        assert_eq!(receipt.quorum_required, 2);
        assert_eq!(receipt.signers, vec![vk(1), vk(2)]);
        assert_eq!(receipt.verifier_signatures.len(), 2);

        // Mirrors the event exactly (signers + total).
        let event: Distributed = env.get_event(&vault, 0).expect("Distributed event");
        assert_eq!(event.total, receipt.total_distributed);
        assert_eq!(event.signers, receipt.signers);
    }

    // R3. dust_retained == pool - paid.
    #[test]
    fn receipt_records_dust_retained() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let a = env.get_account(1);
        let b = env.get_account(2);
        let c = env.get_account(3);
        let mut vault = ServicerVault::deploy(&env, NoArgs);

        vault.register_asset(
            "inv-1".to_string(),
            token,
            vec![(a, U256::from(1)), (b, U256::from(1)), (c, U256::from(1))],
            vec![vk(1), vk(2), vk(3)],
            2,
        );
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());

        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);

        let receipt = vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .expect("receipt");
        // 1000 / 3 = 333 each -> 999 paid, 1 dust retained.
        assert_eq!(receipt.total_distributed, U512::from(999));
        assert_eq!(receipt.dust_retained, U512::from(1));
        assert_eq!(vault.pool_of("inv-1".to_string()), receipt.dust_retained);
    }

    // R4. under-quorum revert leaves no receipt (no phantom receipts).
    #[test]
    fn receipt_absent_when_quorum_not_met() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);

        let (s, v, sg, o, sr) = signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api")]); // 1 < 2
        let res = vault.try_distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);
        assert_revert(res, Error::QuorumNotMet);

        // Fraud path wrote nothing.
        assert!(vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .is_none());
    }

    // R5. idempotent re-distribute does not overwrite the receipt.
    #[test]
    fn receipt_not_overwritten_on_idempotent_redistribute() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);

        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);
        let first = vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .expect("receipt");

        // Second call, same cycle -> AlreadyDistributed (before any receipt write).
        let (s2, v2, sg2, o2, sr2) =
            signed_arrays("inv-1", "c1", &[(3, true, "1000", "ledger"), (2, true, "1000", "stripe")]);
        let res = vault.try_distribute("inv-1".to_string(), "c1".to_string(), s2, v2, sg2, o2, sr2);
        assert_revert(res, Error::AlreadyDistributed);

        let after = vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .expect("receipt still present");
        // First receipt is final — the second distribute did not overwrite.
        assert_eq!(after.signers, first.signers);
        assert_eq!(after.signers, vec![vk(1), vk(2)]);
    }

    // R6. distinct cycles produce distinct receipts.
    #[test]
    fn distinct_cycles_have_distinct_receipts() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);

        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());
        let (s2, v2, sg2, o2, sr2) =
            signed_arrays("inv-1", "c2", &[(2, true, "1000", "stripe"), (3, true, "1000", "ledger")]);
        vault.distribute("inv-1".to_string(), "c2".to_string(), s2, v2, sg2, o2, sr2);

        let r1 = vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .expect("c1 receipt");
        let r2 = vault
            .get_receipt("inv-1".to_string(), "c2".to_string())
            .expect("c2 receipt");
        assert_eq!(r1.cycle_id, "c1");
        assert_eq!(r2.cycle_id, "c2");
        assert_ne!(r1.signers, r2.signers);
        assert_ne!(r1.verifier_signatures, r2.verifier_signatures);
    }

    // ---- SPEC-6: on-chain verifier reputation (RP1–RP10) ---------------

    // RP1. register_asset seeds zeroed registry entries (identity from
    // registration); get_verifier_registry lists them in first-seen order.
    #[test]
    fn register_seeds_zeroed_verifier_reputation() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let alice = env.get_account(1);
        let mut vault = ServicerVault::deploy(&env, NoArgs);
        vault.register_asset(
            "inv-1".to_string(),
            token,
            vec![(alice, U256::from(1))],
            vec![vk(1), vk(2), vk(3)],
            2,
        );
        // Each registered verifier has a zeroed reputation entry — identity
        // exists from registration (Casper example-#2).
        for seed in [1u8, 2, 3] {
            let rep = vault.get_verifier_reputation(vk(seed)).expect("seeded");
            assert_eq!(rep.pubkey, vk(seed));
            assert_eq!((rep.cycles_seen, rep.cycles_voted, rep.cycles_agreed), (0, 0, 0));
            assert!(rep.last_verdict.is_none());
            assert!(rep.last_cycle.is_none());
        }
        let registry = vault.get_verifier_registry();
        assert_eq!(registry.len(), 3);
        assert_eq!(registry[0].pubkey, vk(1));
        assert_eq!(registry[1].pubkey, vk(2));
        assert_eq!(registry[2].pubkey, vk(3));
    }

    // RP2. happy distribute (3 yes): all 3 registered verifiers get
    // seen+1, voted+1, agreed+1; last_verdict == Some(true).
    #[test]
    fn reputation_accumulates_on_happy_distribute() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);
        let (s, v, sg, o, sr) = happy_evidence();
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);
        for seed in [1u8, 2, 3] {
            let rep = vault.get_verifier_reputation(vk(seed)).expect("rep");
            assert_eq!((rep.cycles_seen, rep.cycles_voted, rep.cycles_agreed), (1, 1, 1),
                "seed {}", seed);
            assert_eq!(rep.last_verdict, Some(true));
            assert_eq!(rep.last_cycle.as_deref(), Some("inv-1:c1"));
        }
    }

    // RP3. 2 yes + 1 valid-signed no (quorum met): all 3 seen+1; the 2 yes
    // voted+1 agreed+1; the no-voter voted+1 agreed+0, last_verdict Some(false).
    #[test]
    fn reputation_scores_no_voter_as_disagreeing() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);
        let (s, v, sg, o, sr) = signed_arrays(
            "inv-1",
            "c1",
            &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe"), (3, false, "0", "ledger")],
        );
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);

        let yes1 = vault.get_verifier_reputation(vk(1)).unwrap();
        assert_eq!((yes1.cycles_seen, yes1.cycles_voted, yes1.cycles_agreed), (1, 1, 1));
        assert_eq!(yes1.last_verdict, Some(true));

        let no3 = vault.get_verifier_reputation(vk(3)).unwrap();
        assert_eq!((no3.cycles_seen, no3.cycles_voted, no3.cycles_agreed), (1, 1, 0));
        assert_eq!(no3.last_verdict, Some(false));
    }

    // RP4. 2 yes + 1 non-responder (only 2 signers submitted): all 3 seen+1;
    // 2 responders voted+1 agreed+1; non-responder voted+0 agreed+0, last_verdict None.
    #[test]
    fn reputation_records_non_responder_as_seen_only() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);
        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);

        let r1 = vault.get_verifier_reputation(vk(1)).unwrap();
        assert_eq!((r1.cycles_seen, r1.cycles_voted, r1.cycles_agreed), (1, 1, 1));

        let nr = vault.get_verifier_reputation(vk(3)).unwrap();
        assert_eq!((nr.cycles_seen, nr.cycles_voted, nr.cycles_agreed), (1, 0, 0));
        assert!(nr.last_verdict.is_none());
        assert!(nr.last_cycle.is_none());
    }

    // RP5. get_verifier_reputation returns accumulated stats; get_verifier_registry
    // lists all in first-seen order with accumulated counts.
    #[test]
    fn get_verifier_registry_lists_all_first_seen_order() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);
        let (s, v, sg, o, sr) = happy_evidence();
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);

        let registry = vault.get_verifier_registry();
        assert_eq!(registry.len(), 3);
        assert_eq!(registry[0].pubkey, vk(1));
        assert_eq!(registry[1].pubkey, vk(2));
        assert_eq!(registry[2].pubkey, vk(3));
        assert_eq!(registry[0].cycles_agreed, 1);
    }

    // RP6. Receipt.reputation_snapshot == registry state BEFORE this cycle's
    // increment (the track record brought to this settlement).
    #[test]
    fn receipt_reputation_snapshot_is_pre_increment() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);

        // First settle: snapshot is all-zero (pre-increment).
        let (s, v, sg, o, sr) = happy_evidence();
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);
        let r1 = vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .expect("c1 receipt");
        assert_eq!(r1.reputation_snapshot.len(), 3);
        for snap in &r1.reputation_snapshot {
            assert_eq!((snap.cycles_seen, snap.cycles_voted, snap.cycles_agreed), (0, 0, 0),
                "first-cycle snapshot must be pre-increment (zero)");
        }

        // Second settle (c2): snapshot reflects post-c1 / pre-c2 counts (1,1,1).
        vault.with_tokens(U512::from(1000)).fund("inv-1".to_string());
        let (s2, v2, sg2, o2, sr2) =
            signed_arrays("inv-1", "c2", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c2".to_string(), s2, v2, sg2, o2, sr2);
        let r2 = vault
            .get_receipt("inv-1".to_string(), "c2".to_string())
            .expect("c2 receipt");
        let snap_v1 = r2
            .reputation_snapshot
            .iter()
            .find(|s| s.signer == vk(1))
            .expect("vk(1) in c2 snapshot");
        assert_eq!((snap_v1.cycles_seen, snap_v1.cycles_voted, snap_v1.cycles_agreed), (1, 1, 1));
        // Live registry is now incremented for c2 too.
        let rep = vault.get_verifier_reputation(vk(1)).unwrap();
        assert_eq!((rep.cycles_seen, rep.cycles_voted, rep.cycles_agreed), (2, 2, 2));
    }

    // RP7. halted/fraud cycle (1 yes -> QuorumNotMet revert) does NOT update
    // any reputation (the honest-limitation proof: halted cycles don't score).
    #[test]
    fn halted_cycle_does_not_score_reputation() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);
        let (s, v, sg, o, sr) = signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api")]);
        let res = vault.try_distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);
        assert_revert(res, Error::QuorumNotMet);

        // Reputation untouched — the contract does not score halted cycles.
        for seed in [1u8, 2, 3] {
            let rep = vault.get_verifier_reputation(vk(seed)).unwrap();
            assert_eq!((rep.cycles_seen, rep.cycles_voted, rep.cycles_agreed), (0, 0, 0));
            assert!(rep.last_verdict.is_none());
        }
    }

    // RP8. two sequential successful distributes accumulate (counts grow).
    #[test]
    fn reputation_accumulates_across_sequential_cycles() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);

        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);
        vault.with_tokens(U512::from(1000)).fund("inv-1".to_string());
        let (s2, v2, sg2, o2, sr2) =
            signed_arrays("inv-1", "c2", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c2".to_string(), s2, v2, sg2, o2, sr2);

        let rep = vault.get_verifier_reputation(vk(1)).unwrap();
        assert_eq!((rep.cycles_seen, rep.cycles_voted, rep.cycles_agreed), (2, 2, 2));
        // vk(3) was registered for both cycles but never submitted -> seen only.
        let rep3 = vault.get_verifier_reputation(vk(3)).unwrap();
        assert_eq!((rep3.cycles_seen, rep3.cycles_voted, rep3.cycles_agreed), (2, 0, 0));
    }

    // RP9. a verifier shared across two assets has ONE accumulating registry
    // entry (global registry, cross-asset).
    #[test]
    fn reputation_registry_is_global_across_assets() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let alice = env.get_account(1);
        let bob = env.get_account(2);
        let mut vault = ServicerVault::deploy(&env, NoArgs);

        vault.register_asset(
            "inv-1".to_string(),
            token,
            vec![(alice, U256::from(700)), (bob, U256::from(300))],
            vec![vk(1), vk(2), vk(3)],
            2,
        );
        // inv-2 shares vk(1) and adds vk(4), vk(5).
        vault.register_asset(
            "inv-2".to_string(),
            token,
            vec![(alice, U256::from(1))],
            vec![vk(1), vk(4), vk(5)],
            2,
        );
        vault.with_tokens(U512::from(1000)).fund("inv-1".to_string());
        vault.with_tokens(U512::from(1000)).fund("inv-2".to_string());

        let (s, v, sg, o, sr) = signed_arrays(
            "inv-1", "c1",
            &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe"), (3, true, "1000", "ledger")],
        );
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);
        let (s2, v2, sg2, o2, sr2) =
            signed_arrays("inv-2", "c1", &[(1, true, "1000", "bank-api"), (4, true, "1000", "stripe")]);
        vault.distribute("inv-2".to_string(), "c1".to_string(), s2, v2, sg2, o2, sr2);

        // vk(1) is the shared verifier — ONE entry accumulating both settles.
        let rep = vault.get_verifier_reputation(vk(1)).unwrap();
        assert_eq!((rep.cycles_seen, rep.cycles_voted, rep.cycles_agreed), (2, 2, 2));
        assert_eq!(rep.last_cycle.as_deref(), Some("inv-2:c1")); // most recent
        // vk(2) only settled inv-1.
        let rep2 = vault.get_verifier_reputation(vk(2)).unwrap();
        assert_eq!((rep2.cycles_seen, rep2.cycles_voted, rep2.cycles_agreed), (1, 1, 1));
        // Registry has 5 entries (vk1..vk5), first-seen order.
        let registry = vault.get_verifier_registry();
        assert_eq!(registry.len(), 5);
        assert_eq!(registry[0].pubkey, vk(1));
    }

    // RP10. an unregistered-but-validly-signing pubkey (rejected by SPEC-4) is
    // NOT scored; its reputation stays None; distribute succeeds if registered
    // quorum met.
    #[test]
    fn unregistered_signer_is_not_scored() {
        let env = odra_test::env();
        let token = env.get_account(0);
        let alice = env.get_account(1);
        let bob = env.get_account(2);
        let mut vault = ServicerVault::deploy(&env, NoArgs);
        vault.register_asset(
            "inv-1".to_string(),
            token,
            vec![(alice, U256::from(700)), (bob, U256::from(300))],
            vec![vk(1), vk(2), vk(3)],
            2,
        );
        vault.with_tokens(U512::from(1000)).fund("inv-1".to_string());

        // vk(99) is unregistered but signs validly; vk(1), vk(2) are registered yes.
        // The distribute succeeds (registered quorum met); vk(99) is rejected by
        // the SPEC-4 gate (not registered) and is NOT scored.
        let (s, v, sg, o, sr) = signed_arrays(
            "inv-1", "c1",
            &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe"), (99, true, "1000", "rogue")],
        );
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);

        // vk(99) has no registry entry (never registered -> never seeded -> never scored).
        assert!(vault.get_verifier_reputation(vk(99)).is_none());
        // vk(3) was registered but didn't submit (vk(99) took the 3rd slot) -> seen only.
        let rep3 = vault.get_verifier_reputation(vk(3)).unwrap();
        assert_eq!((rep3.cycles_seen, rep3.cycles_voted, rep3.cycles_agreed), (1, 0, 0));
        let rep1 = vault.get_verifier_reputation(vk(1)).unwrap();
        assert_eq!((rep1.cycles_seen, rep1.cycles_voted, rep1.cycles_agreed), (1, 1, 1));
    }

    // ---- SPEC-5: agentic verification brief (B1–B6) ---------------------
    //
    // The servicer key is captured from the `register_asset` caller, which in
    // OdraVM is the default caller = `get_account(0)` (the same account
    // `funded_vault` uses as the asset `token`). So `record_brief` called with
    // the default caller is the servicer; `set_caller(get_account(1))` simulates
    // a non-servicer for B5.

    // B1. get_brief returns None before any record_brief.
    #[test]
    fn get_brief_none_before_record() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);
        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);
        // Settled but no brief recorded yet.
        assert!(vault.get_brief("inv-1".to_string(), "c1".to_string()).is_none());
    }

    // B2. record_brief after a settled cycle stores it; get_brief returns it.
    #[test]
    fn record_brief_stores_and_reads() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);
        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);

        vault.record_brief(
            "inv-1".to_string(),
            "c1".to_string(),
            "Quorum met: 2/3 verifiers signed yes; funds released pro-rata.".to_string(),
        );
        assert_eq!(
            vault.get_brief("inv-1".to_string(), "c1".to_string()),
            Some("Quorum met: 2/3 verifiers signed yes; funds released pro-rata.".to_string()),
        );
    }

    // B3. record_brief for an unsettled cycle → CycleNotSettled (a brief anchors
    // to a settled cycle — no brief for halts).
    #[test]
    fn record_brief_rejects_unsettled_cycle() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);
        // c2 has not been distributed → no receipt.
        let res = vault.try_record_brief(
            "inv-1".to_string(),
            "c2".to_string(),
            "brief for a cycle that never settled".to_string(),
        );
        assert_revert(res, Error::CycleNotSettled);
    }

    // B4. record_brief twice for the same cycle → BriefAlreadyRecorded (first
    // brief is final — narration is immutable).
    #[test]
    fn record_brief_is_idempotent_first_is_final() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);
        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);

        vault.record_brief("inv-1".to_string(), "c1".to_string(), "first brief".to_string());
        let res = vault.try_record_brief(
            "inv-1".to_string(),
            "c1".to_string(),
            "second brief must be rejected".to_string(),
        );
        assert_revert(res, Error::BriefAlreadyRecorded);
        // The first brief is the one on-chain.
        assert_eq!(
            vault.get_brief("inv-1".to_string(), "c1".to_string()),
            Some("first brief".to_string()),
        );
    }

    // B5. record_brief by a non-servicer key → NotServicer (operational gate —
    // protects narration integrity, never funds).
    #[test]
    fn record_brief_rejects_non_servicer() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);
        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);

        // Switch to a non-servicer caller (account 1 ≠ the servicer account 0).
        env.set_caller(env.get_account(1));
        let res = vault.try_record_brief(
            "inv-1".to_string(),
            "c1".to_string(),
            "brief from a non-servicer".to_string(),
        );
        assert_revert(res, Error::NotServicer);
        // No brief was written.
        assert!(vault.get_brief("inv-1".to_string(), "c1".to_string()).is_none());
    }

    // B6. record_brief over the 1024-byte cap → BriefTooLong (state-bloat
    // defense against a runaway LLM).
    #[test]
    fn record_brief_rejects_overlong_brief() {
        let env = odra_test::env();
        let (mut vault, _alice, _bob) = funded_vault(&env);
        let (s, v, sg, o, sr) =
            signed_arrays("inv-1", "c1", &[(1, true, "1000", "bank-api"), (2, true, "1000", "stripe")]);
        vault.distribute("inv-1".to_string(), "c1".to_string(), s, v, sg, o, sr);

        let overlong = "x".repeat(1025);
        let res = vault.try_record_brief("inv-1".to_string(), "c1".to_string(), overlong);
        assert_revert(res, Error::BriefTooLong);
        // A brief at exactly the cap is accepted.
        vault.record_brief("inv-1".to_string(), "c1".to_string(), "y".repeat(1024));
        assert_eq!(
            vault.get_brief("inv-1".to_string(), "c1".to_string()).map(|b| b.len()),
            Some(1024),
        );
    }
}