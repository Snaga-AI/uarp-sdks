import XCTest
@testable import UARPSDK

/// Decoding bodies the platform really sends, through the generated models.
///
/// `GET /api/v1/tenants/me/readiness` for a company that has never rehearsed.
/// `CompanyTestRun` is declared `type: ["object", "null"]`; until the generator
/// read that off the component, this threw `valueNotFound … test_run`.
final class DecodeTests: XCTestCase {
    private let readinessNeverRehearsed = Data("""
    {
      "ready": false,
      "status": "draft",
      "version": 4,
      "blockers": [{"code": "TEST_RUN_REQUIRED", "message": "Run one rehearsal before launch", "fix": "POST /tenants/me/test-run"}],
      "warnings": [{"code": "PENDING_PROPOSALS", "message": "1 proposed change(s) wait for a decision", "fix": "GET /tenants/me/proposals?status=pending"}],
      "test_run": null
    }
    """.utf8)

    func testReadinessWithoutARehearsalDecodes() throws {
        let readiness = try JSONDecoder().decode(GetTenantReadinessResponse.self, from: readinessNeverRehearsed)
        XCTAssertNil(readiness.testRun)
        XCTAssertEqual(readiness.blockers.count, 1)
    }
}
