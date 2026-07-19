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
}

/// A cryptographically **verified** signature record, stored in the [`Receipt`]
/// as the on-chain quorum proof (SPEC-4).
#[odra::odra_type]
pub struct VerifierSignature {
    pub signer: PublicKey,
    pub verdict: bool,
    pub signature: Bytes,
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
        for i in 0..n {
            let signer = &signers[i];
            // (b) REGISTERED.
            if !cfg.verifiers.contains(signer) {
                continue;
            }
            // (c) DISTINCT — one verified vote per pubkey.
            if verified_signers.contains(signer) {
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

        // 7b. Store the queryable receipt (SPEC-1) — now carrying the
        //     cryptographically verified quorum proof (SPEC-4).
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
}