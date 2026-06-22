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

/// Emitted on a successful distribution. `total` is the amount actually paid
/// out (pool minus integer-division dust).
#[odra::event]
pub struct Distributed {
    pub asset_id: String,
    pub cycle_id: String,
    pub total: U512,
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
}

#[odra::module]
impl ServicerVault {
    /// Register an asset and its distribution rules.
    ///
    /// Reverts [`Error::AssetAlreadyExists`], [`Error::EmptyHolders`],
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
    /// `verdict_hashes` is provenance only (echoed in the event); it does
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
        let mut distinct_registered: Vec<&PublicKey> = Vec::new();
        for signer in signers.iter() {
            let registered = cfg.verifiers.contains(signer);
            let already_counted = distinct_registered.contains(&signer);
            if registered && !already_counted {
                distinct_registered.push(signer);
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
        // `total_weight` is non-zero: holders is non-empty (enforced at
        // registration) and weights are summed as presented. A zero total would
        // mean all-zero weights; guard against the division anyway.
        if total_weight.is_zero() {
            self.env().revert(Error::EmptyHolders);
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

        // 8. Emit the auditable receipt (verdict provenance recorded off-event
        //    in the agent; the event carries the settled totals).
        let _ = verdict_hashes;
        self.env().emit_event(Distributed {
            asset_id,
            cycle_id,
            total: paid,
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
            vec![hash(0xAA), hash(0xBB)],
            vec![vk(1), vk(2)],
        );

        assert_eq!(env.balance_of(&a) - a_before, U512::from(333));
        assert_eq!(env.balance_of(&b) - b_before, U512::from(333));
        assert_eq!(env.balance_of(&c) - c_before, U512::from(333));
        // 1000 - 999 = 1 dust retained, nothing burned.
        assert_eq!(vault.pool_of("inv-1".to_string()), U512::from(1));

        let event: Distributed = env.get_event(&vault, 0).expect("Distributed event");
        assert_eq!(event.total, U512::from(999));
    }
}
