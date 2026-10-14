//! Decoding bodies the platform really sends, through the generated models.
//!
//! The transport tests feed the models payloads written to satisfy them; these
//! feed shapes read off the wire, where a field the document marks nullable
//! arrives as `null` and the model has to say so.

use uarp_sdk::models::GetTenantReadinessResponse;

/// `GET /api/v1/tenants/me/readiness` for a company that has never rehearsed.
/// `CompanyTestRun` is declared `type: ["object", "null"]`; until the generator
/// read that off the component, this threw `invalid type: null, expected struct
/// CompanyTestRun`.
const READINESS_NEVER_REHEARSED: &str = r#"{
  "ready": false,
  "status": "draft",
  "version": 4,
  "blockers": [{"code": "TEST_RUN_REQUIRED", "message": "Run one rehearsal before launch", "fix": "POST /tenants/me/test-run"}],
  "warnings": [{"code": "PENDING_PROPOSALS", "message": "1 proposed change(s) wait for a decision", "fix": "GET /tenants/me/proposals?status=pending"}],
  "test_run": null
}"#;

#[test]
fn readiness_without_a_rehearsal_decodes() {
    let readiness: GetTenantReadinessResponse = serde_json::from_str(READINESS_NEVER_REHEARSED)
        .expect("readiness with test_run: null must decode");
    assert_eq!(readiness.blockers.len(), 1);
    // Asserted through the serialised form rather than `is_none()`, so the test
    // compiles against a model that still declares the field non-null and goes
    // red on the decode — the failure a caller would see — not on the build.
    assert!(serde_json::to_value(&readiness).unwrap()["test_run"].is_null());
}
