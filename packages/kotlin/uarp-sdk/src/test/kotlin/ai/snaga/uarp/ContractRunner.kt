package ai.snaga.uarp

import ai.snaga.uarp.api.agents
import ai.snaga.uarp.api.auth
import ai.snaga.uarp.api.files
import ai.snaga.uarp.api.public
import ai.snaga.uarp.api.registry
import ai.snaga.uarp.api.runs
import ai.snaga.uarp.models.ApplyToJobRequest
import ai.snaga.uarp.models.CompleteOAuthLoginFormPostProvider
import ai.snaga.uarp.models.CompleteOAuthLoginFormPostRequest
import ai.snaga.uarp.models.CreateAgentRequest
import ai.snaga.uarp.models.JobSeniority
import ai.snaga.uarp.models.RegistryPublishRequest
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

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
    val decoded = mapOf(
        "status" to probe.status.value,
        "error_is_absent" to (probe.error == null).toString(),
        "step_seq" to (probe.stepSeq?.toString() ?: "absent"),
        "artifacts_count" to (probe.artifacts?.size?.toString() ?: "absent"),
        "metadata_keys" to (probe.metadata?.keys?.sorted() ?: emptyList()).joinToString(","),
        "metrics_output_tokens" to (probe.metrics?.outputTokens?.toString() ?: "absent"),
        "metrics_input_tokens" to (probe.metrics?.inputTokens?.toString() ?: "absent"),
        "started_at_is_absent" to (probe.startedAt == null).toString(),
    )

    //  17. a POST read as an event stream, consumed to `data: [DONE]`
    val completion = buildJsonObject {
        put("model", "contract/model")
        put("stream", true)
        putJsonArray("messages") {
            addJsonObject {
                put("role", "user")
                put("content", "hi")
            }
        }
    }
    val streamed = StringBuilder()
    client.streamPost("/api/v1/llm/chat/completions", completion).collect { event ->
        val delta = event.json().jsonObject["choices"]!!.jsonArray[0].jsonObject["delta"]!!.jsonObject
        streamed.append(delta["content"]!!.jsonPrimitive.content)
    }

    //  18. a refusal before the stream: an API error, and never retried.
    //  Reported rather than `check`ed, so a stream that wrongly succeeds still
    //  reaches the harness as a mismatched probe.
    var refusal = "no error"
    try {
        client.streamPost("/api/v1/llm/chat/completions/refused", completion).collect { }
    } catch (error: ApiException) {
        refusal = "${error.status} ${error.problem.detail}"
    }

    //  19. a 2xx that is not an event stream: an error, not an empty stream
    var plainEvents = 0
    val plain = try {
        client.streamPost("/api/v1/llm/chat/completions/plain", completion).collect { plainEvents++ }
        "events $plainEvents"
    } catch (error: ApiException) {
        "error ${error.status}"
    }

    //  20. an application/x-www-form-urlencoded body, byte for byte
    val signedIn = client.auth.completeOAuthLoginFormPost(
        CompleteOAuthLoginFormPostProvider.APPLE,
        CompleteOAuthLoginFormPostRequest(
            code = "c 1+2",
            state = "s/ы&=~*",
            user = """{"name":"А Б","email":"a@b.c"}""",
        ),
    )

    //  21. array query parameters: the key once per item, in declaration order
    val jobs = client.public.listPublicJobs(
        seniority = listOf(JobSeniority.JUNIOR, JobSeniority.SENIOR),
        country = listOf("UA"),
    )

    //  22. an array in a multipart body: one JSON array text part
    val applied = client.public.applyToJob(
        "dev",
        ApplyToJobRequest(
            name = "А Б",
            email = "a@b.c",
            links = listOf("https://a.example/x?y=1", "https://b.example/"),
            consent = "true",
        ),
    )

    val probes = decoded + mapOf(
        "post_stream_text" to streamed.toString(),
        "post_stream_refusal" to refusal,
        "post_stream_plain" to plain,
        "form_post_email" to signedIn.email,
        "jobs_total" to jobs.total.toString(),
        "application_id" to applied.application.id,
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
