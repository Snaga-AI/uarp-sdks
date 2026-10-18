package ai.snaga.uarp

import ai.snaga.uarp.models.GetTenantReadinessResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Decoding bodies the platform really sends, through the generated models.
 *
 * `GET /api/v1/tenants/me/readiness` for a company that has never rehearsed.
 * `CompanyTestRun` is declared `type: ["object", "null"]`; until the generator
 * read that off the component, this threw `Expected start of the object '{'`.
 */
class DecodeTest {
    private val readinessNeverRehearsed = """
        {
          "ready": false,
          "status": "draft",
          "version": 4,
          "blockers": [{"code": "TEST_RUN_REQUIRED", "message": "Run one rehearsal before launch", "fix": "POST /tenants/me/test-run"}],
          "warnings": [{"code": "PENDING_PROPOSALS", "message": "1 proposed change(s) wait for a decision", "fix": "GET /tenants/me/proposals?status=pending"}],
          "test_run": null
        }
    """.trimIndent()

    @Test
    fun readinessWithoutARehearsalDecodes() {
        val readiness = uarpJson.decodeFromString(GetTenantReadinessResponse.serializer(), readinessNeverRehearsed)
        assertNull(readiness.testRun)
        assertEquals(1, readiness.blockers.size)
    }
}
