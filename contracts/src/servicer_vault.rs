//! `ServicerVault` — the on-chain core of Quittance.
//!
//! Custodies a per-asset distribution pool funded by a borrower's verified
//! cashflow and releases the entire pool to token holders **pro-rata** — but
//! only when the servicer agent presents a **quorum of registered verifiers**,
//! and only **once per cycle** (idempotent).
//!
//! Trust anchor: `@quittance/agent` is the sole caller of [`ServicerVault::distribute`].

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
/// integer-division dust). `signers` and `verdict_hashes` carry the quorum
/// provenance so anyone reading the log can re-check that the gate was met:
/// `signers` is the set of distinct, registered verifiers that satisfied the
/// quorum, and `verdict_hashes` is the verdict-hash digests presented for the
/// cycle.
#[odra::event]
pub struct Distributed {
    pub asset_id: String,
    pub cycle_id: String,
    pub total: U512,
    /// Distinct registered verifiers whose presence satisfied the quorum gate.
    pub signers: Vec<PublicKey>,
    /// Verdict-hash digests presented for this cycle (provenance, as supplied).
    pub verdict_hashes: Vec<[u8; 32]>,
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
    /// Fewer than `quorum` distinct registered signers presented.
    QuorumNotMet = 6,
    /// The pool for this asset is empty (nothing funded for the cycle).
    InsufficientPool = 7,
    /// `register_asset` called with a non-empty holder list whose weights sum
    /// to zero (no holder can ever receive a share).
    ZeroTotalWeight = 8,
}

/// Stored on-chain receipt for a settled `(asset_id, cycle_id)` cycle — the
/// queryable mirror of the [`Distributed`] event (SPEC-1). Records the payout
/// totals plus the quorum proof (distinct registered signers + verdict-hash
/// digests). SPEC-4/5/6 extend this struct with verifier signatures, the AI
/// brief hash, and the reputation snapshot.
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
    /// Distinct registered verifiers whose presence satisfied the gate.
    pub signers: Vec<PublicKey>,
    /// Verdict-hash digests presented for the cycle (provenance).
    pub verdict_hashes: Vec<[u8; 32]>,
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
        // Reject an all-zero-weight registry up front: a non-empty holder list
        // whose weights sum to zero can never distribute (every pro-rata share
        // would be `pool * 0 / 0`). Failing fast here makes the divide-by-zero
        // path in `distribute` unreachable by construction.
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
    /// The quorum proof — the distinct registered signer set that satisfied the
    /// gate and the `verdict_hashes` digests — is recorded in the emitted
    /// [`Distributed`] event. `verdict_hashes` is provenance only; it does
    /// **not** gate distribution. See the TRUST BOUNDARY note in the body.
    pub fn distribute(
        &mut self,
        asset_id: String,
        cycle_id: String,
        verdict_hashes: Vec<[u8; 32]>,
        signers: Vec<PublicKey>,
    ) {
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

        // 3. Quorum gate.
        //
        // TRUST BOUNDARY: we trust the agent's `signers` list. We verify only
        // that each presented signer is a *registered* verifier and that the
        // count of *distinct* registered signers reaches `quorum`. We do NOT
        // verify verifier signatures over the verdict on-chain — `distribute`
        // carries no signatures. The real cryptographic signature check happens
        // off-chain in the agent's `reachQuorum`. `verdict_hashes` is recorded
        // for provenance only and does not gate distribution. On-chain
        // signature verification is a Final-Round enhancement.
        //
        // `distinct_registered` is the deduped, registered signer set that the
        // gate accepted — captured (owned) so it can be recorded in the
        // `Distributed` event as the on-chain quorum proof.
        let mut distinct_registered: Vec<PublicKey> = Vec::new();
        for signer in signers.iter() {
            let registered = cfg.verifiers.contains(signer);
            let already_counted = distinct_registered.contains(signer);
            if registered && !already_counted {
                distinct_registered.push(signer.clone());
            }
        }
        if distinct_registered.len() < cfg.quorum as usize {
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
        // `total_weight` is non-zero by construction: `register_asset` rejects a
        // zero-sum holder list with `ZeroTotalWeight`, so any stored config has
        // a positive total. This guard is defense-in-depth and is unreachable;
        // it reverts the correctly-labeled error rather than the misleading
        // `EmptyHolders`.
        if total_weight.is_zero() {
            self.env().revert(Error::ZeroTotalWeight);
        }

        let mut paid = U512::zero();
        for (holder, weight) in cfg.holders.iter() {
            // `pool * weight` panics-reverts on U512 overflow (no silent wrap);
            // integer division floors, so the running `paid` never exceeds
            // `pool`. Dust (the remainder) is retained in the pool below.
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

        // 7b. Store the queryable receipt (SPEC-1) — same facts as the event,
        //     readable via `get_receipt`. No change to the gate or payout.
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
                signers: distinct_registered.clone(),
                verdict_hashes: verdict_hashes.clone(),
            },
        );

        // 8. Emit the auditable record: settled totals plus the quorum proof —
        //    the distinct registered signer set that satisfied the gate and the
        //    verdict-hash digests presented — so anyone reading the log can
        //    re-check that >=2 independent signers attested before funds moved.
        self.env().emit_event(Distributed {
            asset_id,
            cycle_id,
            total: paid,
            signers: distinct_registered,
            verdict_hashes,
        });
    }
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
    use odra::casper_types::SecretKey;
    use odra::host::{Deployer, HostRef, NoArgs};

    // ---- helpers -------------------------------------------------------------

    /// Deterministic, distinct ed25519 verifier key from a single-byte seed.
    /// Derived from a SecretKey so the public key is always a valid curve point.
    fn vk(seed: u8) -> PublicKey {
        let sk = SecretKey::ed25519_from_bytes([seed; 32])
            .expect("32-byte ed25519 seed is always valid");
        PublicKey::from(&sk)
    }

    /// A 32-byte verdict hash filled with `b`.
    fn hash(b: u8) -> [u8; 32] {
        [b; 32]
    }

    /// Assert a `try_*` result reverted with the given contract error.
    ///
    /// Compares on the on-chain error **code** (the variant discriminant),
    /// independent of the human-readable message the host attaches.
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
            3, // 3 > 2 verifiers
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

        // Non-empty holders, but every weight is zero -> no distributable share.
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

    // 6. distribute happy path (pro-rata + event)
    #[test]
    fn distribute_pays_pro_rata_and_emits_event() {
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
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());

        let alice_before = env.balance_of(&alice);
        let bob_before = env.balance_of(&bob);

        vault.distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xAA), hash(0xBB)],
            vec![vk(1), vk(2)],
        );

        assert_eq!(env.balance_of(&alice) - alice_before, U512::from(700));
        assert_eq!(env.balance_of(&bob) - bob_before, U512::from(300));
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::zero());

        let event: Distributed = env.get_event(&vault, 0).expect("Distributed event");
        assert_eq!(event.asset_id, "inv-1");
        assert_eq!(event.cycle_id, "c1");
        assert_eq!(event.total, U512::from(1000));
        // Quorum proof recorded on-chain: the distinct registered signers that
        // satisfied the gate, and the exact verdict hashes presented.
        assert_eq!(event.signers, vec![vk(1), vk(2)]);
        assert_eq!(event.verdict_hashes, vec![hash(0xAA), hash(0xBB)]);
    }

    // 7. distribute fraud / under-quorum
    #[test]
    fn distribute_reverts_under_quorum_and_preserves_state() {
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
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());

        let alice_before = env.balance_of(&alice);
        let bob_before = env.balance_of(&bob);

        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xAA)],
            vec![vk(1)], // 1 < quorum 2
        );
        assert_revert(res, Error::QuorumNotMet);

        assert_eq!(env.balance_of(&alice), alice_before);
        assert_eq!(env.balance_of(&bob), bob_before);
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::from(1000));
    }

    // 8. distribute dedups a doubled signer
    #[test]
    fn distribute_dedups_doubled_signer() {
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
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());

        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xAA)],
            vec![vk(1), vk(1)], // one distinct signer
        );
        assert_revert(res, Error::QuorumNotMet);
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::from(1000));
    }

    // 9. distribute ignores a non-registered signer
    #[test]
    fn distribute_ignores_non_registered_signer() {
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
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());

        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xAA)],
            vec![vk(1), vk(99)], // vk(99) not registered -> only vk(1) counts
        );
        assert_revert(res, Error::QuorumNotMet);
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::from(1000));
    }

    // 10. distribute idempotent per cycle
    #[test]
    fn distribute_is_idempotent_per_cycle() {
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
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());

        vault.distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xAA), hash(0xBB)],
            vec![vk(1), vk(2)],
        );

        let alice_after_first = env.balance_of(&alice);
        let bob_after_first = env.balance_of(&bob);

        // Second call, same (asset, cycle) -> AlreadyDistributed, no payment.
        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xAA), hash(0xBB)],
            vec![vk(1), vk(2)],
        );
        assert_revert(res, Error::AlreadyDistributed);
        assert_eq!(env.balance_of(&alice), alice_after_first);
        assert_eq!(env.balance_of(&bob), bob_after_first);

        // A different cycle, after re-funding, distributes normally.
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());
        vault.distribute(
            "inv-1".to_string(),
            "c2".to_string(),
            vec![hash(0xCC), hash(0xDD)],
            vec![vk(1), vk(2)],
        );
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

        let alice_before = env.balance_of(&alice);
        let bob_before = env.balance_of(&bob);

        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xAA), hash(0xBB)],
            vec![vk(1), vk(2)],
        );
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

        vault.distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xCC), hash(0xDD)],
            vec![vk(1), vk(2)],
        );

        assert_eq!(env.balance_of(&a) - a_before, U512::from(333));
        assert_eq!(env.balance_of(&b) - b_before, U512::from(333));
        assert_eq!(env.balance_of(&c) - c_before, U512::from(333));
        // 1000 - 999 = 1 dust retained, nothing burned.
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::from(1));

        let event: Distributed = env.get_event(&vault, 0).expect("Distributed event");
        assert_eq!(event.total, U512::from(999));
        // Quorum proof recorded even when dust is carried.
        assert_eq!(event.signers, vec![vk(1), vk(2)]);
        assert_eq!(event.verdict_hashes, vec![hash(0xCC), hash(0xDD)]);
    }

    // ---- SPEC-1: queryable on-chain receipts (R1–R6) ----------------------

    // R1. get_receipt returns None before distribute.
    #[test]
    fn get_receipt_none_before_distribute() {
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
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());

        assert!(vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .is_none());
    }

    // R2. after happy distribute, get_receipt mirrors the event.
    #[test]
    fn get_receipt_mirrors_event_after_distribute() {
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
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());

        vault.distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xAA), hash(0xBB)],
            vec![vk(1), vk(2)],
        );

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
        assert_eq!(receipt.verdict_hashes, vec![hash(0xAA), hash(0xBB)]);

        // Mirrors the event exactly.
        let event: Distributed = env.get_event(&vault, 0).expect("Distributed event");
        assert_eq!(event.total, receipt.total_distributed);
        assert_eq!(event.signers, receipt.signers);
        assert_eq!(event.verdict_hashes, receipt.verdict_hashes);
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

        vault.distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xCC), hash(0xDD)],
            vec![vk(1), vk(2)],
        );

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
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());

        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xAA)],
            vec![vk(1)], // 1 < quorum 2
        );
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
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());

        vault.distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xAA), hash(0xBB)],
            vec![vk(1), vk(2)],
        );
        let first = vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .expect("receipt");

        // Second call, same cycle -> AlreadyDistributed (before any receipt write).
        let res = vault.try_distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xCC), hash(0xDD)], // different hashes must not overwrite
            vec![vk(1), vk(2)],
        );
        assert_revert(res, Error::AlreadyDistributed);

        let after = vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .expect("receipt still present");
        assert_eq!(after.verdict_hashes, first.verdict_hashes);
        assert_eq!(after.verdict_hashes, vec![hash(0xAA), hash(0xBB)]);
    }

    // R6. distinct cycles produce distinct receipts.
    #[test]
    fn distinct_cycles_have_distinct_receipts() {
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
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());

        vault.distribute(
            "inv-1".to_string(),
            "c1".to_string(),
            vec![hash(0xAA), hash(0xBB)],
            vec![vk(1), vk(2)],
        );
        vault
            .with_tokens(U512::from(1000))
            .fund("inv-1".to_string());
        vault.distribute(
            "inv-1".to_string(),
            "c2".to_string(),
            vec![hash(0xCC), hash(0xDD)],
            vec![vk(2), vk(3)],
        );

        let r1 = vault
            .get_receipt("inv-1".to_string(), "c1".to_string())
            .expect("c1 receipt");
        let r2 = vault
            .get_receipt("inv-1".to_string(), "c2".to_string())
            .expect("c2 receipt");
        assert_eq!(r1.cycle_id, "c1");
        assert_eq!(r2.cycle_id, "c2");
        assert_ne!(r1.signers, r2.signers);
        assert_ne!(r1.verdict_hashes, r2.verdict_hashes);
    }
}
