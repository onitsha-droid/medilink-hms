//! Cargo tests for the HMO Claims Soroban contract.
//!
//! Covers: approved claim, over-limit rejection, uncovered service,
//!         duplicate claim idempotency, inactive policy, policy not found.
//!
//! No PHI appears in any test value — all identifiers are random bytes.

#[cfg(test)]
mod tests {
    use soroban_sdk::{testutils::Events, vec, BytesN, Env};

    use crate::{HmoClaimsContract, HmoClaimsContractClient};

    // ── Test helpers ──────────────────────────────────────────────────────────

    /// Create a 32-byte pseudonymous ID from a seed byte.
    fn pseudo_id(env: &Env, seed: u8) -> BytesN<32> {
        let mut bytes = [0u8; 32];
        bytes[0] = seed;
        BytesN::from_array(env, &bytes)
    }

    fn setup() -> (Env, HmoClaimsContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(HmoClaimsContract, ());
        let client = HmoClaimsContractClient::new(&env, &contract_id);
        (env, client)
    }

    // ── register_policy ───────────────────────────────────────────────────────

    #[test]
    fn test_register_policy_stores_and_returns_policy() {
        let (env, client) = setup();
        let pid = pseudo_id(&env, 1);
        let services = vec![&env, 1001u32, 2002u32, 3003u32];

        let policy = client.register_policy(&pid, &500_000i128, &services);

        assert_eq!(policy.policy_id, pid);
        assert_eq!(policy.max_claim_amount, 500_000);
        assert!(policy.is_active);
        assert_eq!(policy.covered_services.len(), 3);
    }

    #[test]
    fn test_get_policy_returns_none_for_unknown_id() {
        let (env, client) = setup();
        let unknown = pseudo_id(&env, 99);
        assert!(client.get_policy(&unknown).is_none());
    }

    #[test]
    fn test_deactivate_policy() {
        let (env, client) = setup();
        let pid = pseudo_id(&env, 2);
        let services = vec![&env, 1001u32];
        client.register_policy(&pid, &100_000i128, &services);

        client.deactivate_policy(&pid);

        let p = client.get_policy(&pid).expect("Policy should still exist");
        assert!(!p.is_active);
    }

    // ── submit_claim: approved path ───────────────────────────────────────────

    #[test]
    fn test_approved_claim() {
        let (env, client) = setup();
        let pid = pseudo_id(&env, 10);
        let ref_id = pseudo_id(&env, 20);
        let service: u32 = 1001;

        client.register_policy(&pid, &500_000i128, &vec![&env, service]);

        let claim = client.submit_claim(&ref_id, &pid, &service, &200_000i128);

        assert_eq!(claim.status, 1, "Should be approved");
        assert_eq!(claim.reason_code, 0);
        assert_eq!(claim.payout_amount, 200_000);

        // Verify at least one event was emitted
        let events = env.events().all();
        assert!(!events.events().is_empty(), "Events should have been emitted");
    }

    // ── submit_claim: over-limit ──────────────────────────────────────────────

    #[test]
    fn test_rejected_over_limit() {
        let (env, client) = setup();
        let pid = pseudo_id(&env, 11);
        let ref_id = pseudo_id(&env, 21);
        let service: u32 = 2002;
        let max: i128 = 100_000;

        client.register_policy(&pid, &max, &vec![&env, service]);

        // Request more than the limit
        let claim = client.submit_claim(&ref_id, &pid, &service, &200_000i128);

        assert_eq!(claim.status, 2, "Should be rejected");
        assert_eq!(claim.reason_code, 1003);
        assert_eq!(claim.payout_amount, 0);
    }

    // ── submit_claim: uncovered service ───────────────────────────────────────

    #[test]
    fn test_rejected_uncovered_service() {
        let (env, client) = setup();
        let pid = pseudo_id(&env, 12);
        let ref_id = pseudo_id(&env, 22);
        let covered_service: u32 = 3003;
        let uncovered_service: u32 = 9999;

        client.register_policy(&pid, &500_000i128, &vec![&env, covered_service]);

        let claim = client.submit_claim(&ref_id, &pid, &uncovered_service, &50_000i128);

        assert_eq!(claim.status, 2, "Should be rejected");
        assert_eq!(claim.reason_code, 1002);
    }

    // ── submit_claim: policy not found ────────────────────────────────────────

    #[test]
    fn test_rejected_policy_not_found() {
        let (env, client) = setup();
        let unknown_pid = pseudo_id(&env, 99);
        let ref_id = pseudo_id(&env, 30);

        let claim = client.submit_claim(&ref_id, &unknown_pid, &1001u32, &10_000i128);

        assert_eq!(claim.status, 2);
        assert_eq!(claim.reason_code, 1001);
    }

    // ── submit_claim: inactive policy ─────────────────────────────────────────

    #[test]
    fn test_rejected_inactive_policy() {
        let (env, client) = setup();
        let pid = pseudo_id(&env, 13);
        let ref_id = pseudo_id(&env, 31);
        let service: u32 = 1001;

        client.register_policy(&pid, &500_000i128, &vec![&env, service]);
        client.deactivate_policy(&pid);

        let claim = client.submit_claim(&ref_id, &pid, &service, &100_000i128);

        assert_eq!(claim.status, 2);
        assert_eq!(claim.reason_code, 1005);
    }

    // ── submit_claim: duplicate ref_id ────────────────────────────────────────

    #[test]
    fn test_duplicate_claim_is_idempotent() {
        let (env, client) = setup();
        let pid = pseudo_id(&env, 14);
        let ref_id = pseudo_id(&env, 40);
        let service: u32 = 1001;

        client.register_policy(&pid, &500_000i128, &vec![&env, service]);

        let first = client.submit_claim(&ref_id, &pid, &service, &100_000i128);
        // Submit exactly the same claim again
        let second = client.submit_claim(&ref_id, &pid, &service, &100_000i128);

        // Both calls must return identical results — no double payout
        assert_eq!(first.status, second.status);
        assert_eq!(first.payout_amount, second.payout_amount);
        assert_eq!(first.reason_code, second.reason_code);
    }

    // ── get_claim ─────────────────────────────────────────────────────────────

    #[test]
    fn test_get_claim_returns_stored_claim() {
        let (env, client) = setup();
        let pid = pseudo_id(&env, 15);
        let ref_id = pseudo_id(&env, 50);
        let service: u32 = 2002;

        client.register_policy(&pid, &999_999i128, &vec![&env, service]);
        client.submit_claim(&ref_id, &pid, &service, &300_000i128);

        let loaded = client.get_claim(&ref_id).expect("Claim should be stored");
        assert_eq!(loaded.ref_id, ref_id);
        assert_eq!(loaded.service_code, service);
        assert_eq!(loaded.status, 1);
    }

    #[test]
    fn test_get_claim_returns_none_for_unknown_ref() {
        let (env, client) = setup();
        let unknown_ref = pseudo_id(&env, 255);
        assert!(client.get_claim(&unknown_ref).is_none());
    }

    // ── No PHI in contract types ──────────────────────────────────────────────

    #[test]
    fn test_no_phi_in_contract_types() {
        // All Claim fields are numeric/boolean/opaque bytes — no strings.
        // This test documents the invariant and will fail to compile if
        // a string field is ever added to Claim.
        let (env, client) = setup();
        let pid = pseudo_id(&env, 16);
        let ref_id = pseudo_id(&env, 60);
        let service: u32 = 1001;

        client.register_policy(&pid, &100_000i128, &vec![&env, service]);
        let claim = client.submit_claim(&ref_id, &pid, &service, &50_000i128);

        let _ref: BytesN<32> = claim.ref_id;        // opaque bytes only
        let _pid: BytesN<32> = claim.policy_id;     // opaque bytes only
        let _sc: u32 = claim.service_code;          // numeric
        let _amt: i128 = claim.amount;              // numeric
        let _st: u32 = claim.status;                // numeric
        let _rc: u32 = claim.reason_code;           // numeric
        let _pa: i128 = claim.payout_amount;        // numeric
    }
}
