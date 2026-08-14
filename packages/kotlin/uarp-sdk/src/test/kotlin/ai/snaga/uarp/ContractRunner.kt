package ai.snaga.uarp

import ai.snaga.uarp.api.agents
import ai.snaga.uarp.api.files
import ai.snaga.uarp.api.registry
import ai.snaga.uarp.api.runs
import ai.snaga.uarp.models.CreateAgentRequest
import ai.snaga.uarp.models.RegistryPublishRequest
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Contract runner for the Kotlin SDK.
 *
 * Performs the sequence in contract/SCENARIOS.md against the contract server.
 * It asserts nothing about the traffic: the server records it and run.sh
 * compares the five traces. It lives in the test source set so it stays out of
 * the published artifact.
 *
 *   UARP_CONTRACT_BASE_URL=http://127.0.0.1:8940 ./gradlew :uarp-sdk:contract
 */
/**
 * A quote, a backslash, a newline, a tab, a non-ASCII letter and a character
 * outside the basic plane — everything a JSON encoder has to escape or carry.
 */
private const val AWKWARD = "\"q\" \\ \n \t ы 😀"

fun main() = runBlocking {
    val base = System.getenv("UARP_CONTRACT_BASE_URL")
        ?: error("UARP_CONTRACT_BASE_URL is not set")

    val client = UarpClient.builder()
        .apiKey("uarp_contract_secret")
        .baseUrl(base)
        .maxRetries(2)
        .build()

    //  1. query serialisation
    client.agents.list(limit = 2)

    //  2. path encoding
    client.agents.get("id with/slash")

    //  3. JSON body and the automatic idempotency key
    client.agents.create(
        CreateAgentRequest(
            name = "demo",
        ),
    )

    //  4. cursor paging, consumed to the end
    client.agents.listAll().collect { }

    //  5. a 429 that is retried
    client.agents.get("retry-me")

    //  6. a 404 that is not
    var refused = false
    try {
        client.agents.get("missing")
    } catch (error: ApiException) {
        refused = true
    }
    //  A scenario that silently does not happen would make the traces agree
    //  for the wrong reason.
    check(refused) { "expected a 404" }

    //  7. an event stream, stopped by the caller
    client.runs.streamRunEvents("r1")
        .takeWhile { it.event != "run.completed" }
        .collect { }

    //  8. binary download
    client.files.downloadFileContent("f1")

    //  9. no content
    client.files.delete("f1")

    //  10. multipart upload
    client.registry.registryPublish(
        RegistryPublishRequest(
            manifest = """{"name":"demo"}""",
            artifact = FilePart(filename = "artifact", data = byteArrayOf(0x00, 0xFF.toByte(), 0x41)),
            sha256 = "abc123",
        ),
    )

    //  11. query encoding, spaces and reserved characters included
    client.agents.list(workspaceId = "ы w&x=y+z*!()~")

    //  12. a multibyte path segment
    client.agents.get("агент/ы")

    //  13. a header parameter
    client.runs.streamRunEvents("r1", lastEventId = "42")
        .takeWhile { it.event != "run.completed" }
        .collect { }

    //  14. zero and false must survive, not be dropped as falsy
    client.agents.list(limit = 0, includeOffline = false)

    //  15. JSON string escaping and a zero in a body
    client.runs.create(
        ai.snaga.uarp.models.CreateRunRequest(agentId = AWKWARD, sessionId = "", version = 0),
    )

    //  16. how the decoder handles a payload built to strain it
    val probe = client.runs.get("probe")
    val probes = mapOf(
        "status" to probe.status.value,
        "error_is_absent" to (probe.error == null).toString(),
        "step_seq" to (probe.stepSeq?.toString() ?: "absent"),
        "artifacts_count" to (probe.artifacts?.size?.toString() ?: "absent"),
        "metadata_keys" to (probe.metadata?.keys?.sorted() ?: emptyList()).joinToString(","),
        "metrics_output_tokens" to (probe.metrics?.outputTokens?.toString() ?: "absent"),
        "metrics_input_tokens" to (probe.metrics?.inputTokens?.toString() ?: "absent"),
        "started_at_is_absent" to (probe.startedAt == null).toString(),
    )

    val report = buildJsonObject {
        put("language", JsonPrimitive("kotlin"))
        put("probes", JsonObject(probes.mapValues { JsonPrimitive(it.value) }))
    }
    client.request<JsonElement>(
        RequestSpec(method = "POST", path = "/__report", body = Body.Json(report.toString())),
    )

    println("kotlin runner done")
}
