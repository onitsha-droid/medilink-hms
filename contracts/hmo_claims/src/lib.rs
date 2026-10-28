//! HMO Claims Soroban Contract
//!
//! # Privacy Rules (README §Blockchain Design & Privacy)
//! - NO patient identity, names, dates of birth, or any PHI stored on-chain.
//! - Only PSEUDONYMOUS policy IDs (opaque 32-byte blobs) and opaque reference
//!   IDs are used. Service codes are numeric only. No names or demographics.
//!
//! # Functions
//! - `register_policy`   — Admin registers an HMO policy.
//! - `deactivate_policy` — Admin deactivates a policy.
//! - `get_policy`        — Read a policy by pseudonymous policy_id.
//! - `submit_claim`      — Billing Officer submits and auto-verifies a claim.
//! - `get_claim`         — Read a single claim by opaque reference ID.
//!
//! # Events emitted
//! - topic `("claim_approved",)` data `(ref_id, policy_id, payout_amount)`
//! - topic `("claim_rejected",)` data `(ref_id, policy_id, reason_code)`
//!
//! # Rejection reason codes (u32)
//! | Code | Meaning                                   |
//! |------|-------------------------------------------|
//! | 1001 | Policy not found                          |
//! | 1002 | Service code not covered by policy        |
//! | 1003 | Claim amount exceeds policy limit         |
//! | 1004 | Duplicate claim (ref_id already processed)|
//! | 1005 | Policy inactive                           |

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, BytesN, Env, Symbol, Vec,
};

// ── Data types ────────────────────────────────────────────────────────────────

/// A registered HMO policy.
/// All identifiers are pseudonymous byte strings — never real patient data.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    /// Pseudonymous 32-byte policy identifier (not linkable to any real identity)
    pub policy_id: BytesN<32>,
    /// Maximum single-claim payout in the smallest unit (e.g. stroops or kobo)
    pub max_claim_amount: i128,
    /// Numeric service codes covered by this policy (ICD-10-style codes as u32)
    pub covered_services: Vec<u32>,
    /// Whether the policy is currently active
    pub is_active: bool,
}

/// A submitted and verified claim.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Claim {
    /// Opaque reference ID (e.g. invoice ObjectId as 32 bytes)
    pub ref_id: BytesN<32>,
    /// Pseudonymous policy ID this claim was submitted against
    pub policy_id: BytesN<32>,
    /// Numeric service code
    pub service_code: u32,
    /// Requested amount
    pub amount: i128,
    /// 0 = pending (unused after submit), 1 = approved, 2 = rejected
    pub status: u32,
    /// Rejection reason code (0 if approved)
    pub reason_code: u32,
    /// Approved payout amount (0 if rejected)
    pub payout_amount: i128,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

fn policy_key(env: &Env, policy_id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(env, "policy"), policy_id.clone())
}

fn claim_key(env: &Env, ref_id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(env, "claim"), ref_id.clone())
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct HmoClaimsContract;

#[contractimpl]
impl HmoClaimsContract {
    /// Register or update an HMO policy.
    ///
    /// `policy_id` must be a pseudonymous 32-byte identifier — not a real patient ID.
    /// `covered_services` is a list of u32 numeric service codes.
    /// `max_claim_amount` is the ceiling per claim in the smallest monetary unit.
    pub fn register_policy(
        env: Env,
        policy_id: BytesN<32>,
        max_claim_amount: i128,
        covered_services: Vec<u32>,
    ) -> Policy {
        let policy = Policy {
            policy_id: policy_id.clone(),
            max_claim_amount,
            covered_services,
            is_active: true,
        };
        env.storage()
            .persistent()
            .set(&policy_key(&env, &policy_id), &policy);
        policy
    }

    /// Deactivate a policy so no new claims can be approved against it.
    pub fn deactivate_policy(env: Env, policy_id: BytesN<32>) {
        let key = policy_key(&env, &policy_id);
        let mut policy: Policy = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Policy not found");
        policy.is_active = false;
        env.storage().persistent().set(&key, &policy);
    }

    /// Read a policy. Returns None if the policy_id is unknown.
    pub fn get_policy(env: Env, policy_id: BytesN<32>) -> Option<Policy> {
        env.storage()
            .persistent()
            .get(&policy_key(&env, &policy_id))
    }

    /// Submit a claim and immediately verify it against the stored policy.
    ///
    /// Verification order:
    ///   1. Duplicate ref_id → return existing claim unchanged (idempotent).
    ///   2. Policy not found  → reject with code 1001.
    ///   3. Policy inactive   → reject with code 1005.
    ///   4. Service not covered → reject with code 1002.
    ///   5. Amount > max_claim_amount → reject with code 1003.
    ///   6. Otherwise → approve; payout = amount.
    ///
    /// Emits `claim_approved` or `claim_rejected` event.
    pub fn submit_claim(
        env: Env,
        ref_id: BytesN<32>,
        policy_id: BytesN<32>,
        service_code: u32,
        amount: i128,
    ) -> Claim {
        let ck = claim_key(&env, &ref_id);

        // ── Idempotency: duplicate ref_id returns existing claim ──────────
        if env.storage().persistent().has(&ck) {
            return env.storage().persistent().get::<_, Claim>(&ck).unwrap();
        }

        // ── Policy lookup and verification ────────────────────────────────
        let (status, reason_code, payout_amount) =
            match env
                .storage()
                .persistent()
                .get::<_, Policy>(&policy_key(&env, &policy_id))
            {
                None => (2u32, 1001u32, 0i128),
                Some(p) if !p.is_active => (2, 1005, 0),
                Some(p) => {
                    let covered = p.covered_services.iter().any(|c| c == service_code);
                    if !covered {
                        (2, 1002, 0)
                    } else if amount > p.max_claim_amount {
                        (2, 1003, 0)
                    } else {
                        (1, 0, amount)
                    }
                }
            };

        let claim = Claim {
            ref_id: ref_id.clone(),
            policy_id: policy_id.clone(),
            service_code,
            amount,
            status,
            reason_code,
            payout_amount,
        };

        env.storage().persistent().set(&ck, &claim);

        // ── Emit event ────────────────────────────────────────────────────
        if status == 1 {
            env.events().publish(
                (Symbol::new(&env, "claim_approved"),),
                (ref_id, policy_id, payout_amount),
            );
        } else {
            env.events().publish(
                (Symbol::new(&env, "claim_rejected"),),
                (ref_id, policy_id, reason_code),
            );
        }

        claim
    }

    /// Read a claim by its opaque reference ID. Returns None if not found.
    pub fn get_claim(env: Env, ref_id: BytesN<32>) -> Option<Claim> {
        env.storage()
            .persistent()
            .get(&claim_key(&env, &ref_id))
    }
}

mod test;
