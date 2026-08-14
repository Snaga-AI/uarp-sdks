package ai.snaga.uarp

import ai.snaga.uarp.api.agents
import ai.snaga.uarp.api.auth
import ai.snaga.uarp.api.health
import ai.snaga.uarp.models.AgentModelConfig
import ai.snaga.uarp.models.AgentModelConfigProvider
import ai.snaga.uarp.models.CreateAgentRequest
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Live runner for the Kotlin SDK.
 *
 * Performs smoke/live/SCENARIO.md against the real server and prints one JSON
 * object. It asserts almost nothing itself: compare.py decides whether the five
 * languages agree. It lives in the test source set so it stays out of the
 * published artifact.
 *
 *   UARP_API_KEY=… ./gradlew :uarp-sdk:live
 */
private const val LANGUAGE = "kotlin"
private const val MISSING_ID = "00000000-0000-4000-8000-000000000000"

/**
 * Reported in place of a value the SDK could not read. The wording is shared by
 * all five runners so that "both failed" compares equal; the reason goes to
 * stderr, where it does not affect the comparison.
 */
private const val DECODE_FAILED = "decode failed"

fun main() = runBlocking {
    val agentName = "smoke-live-$LANGUAGE"
    val client = UarpClient.builder()
        .apiKey(System.getenv("UARP_API_KEY") ?: error("UARP_API_KEY is not set"))
        .baseUrl(System.getenv("UARP_BASE_URL") ?: "https://api.snaga.ai")
        .maxRetries(2)
        .build()

    //  1. public health, no authorisation needed
    val health = client.health.get().status

    //  2. the key resolves to an identity
    val me = client.auth.getMe()

    //  3. a list with query parameters.
    //
    //     A decode failure is reported rather than thrown: the whole point of
    //     running five SDKs against one server is to see which of them cannot
    //     read what it sends, and an exception here would hide that behind a
    //     stack trace instead of putting it in the comparison.
    var pageSize: Any = DECODE_FAILED
    try {
        pageSize = minOf(client.agents.list(limit = 2).items.size, 2)
    } catch (error: DecodingException) {
        System.err.println("page_size: ${error.message}")
    }

    //  4. a 404 that must arrive as a typed error carrying a problem document
    var notFoundStatus = -1
    var problemHasTitle = false
    try {
        client.agents.get(MISSING_ID)
    } catch (error: ApiException) {
        notFoundStatus = error.status
        problemHasTitle = !error.problem.title.isNullOrEmpty()
    }

    //  5. a write, with the idempotency key the SDK attaches on its own
    var createdId: String? = null
    var created: Any = false
    var createError = 0
    try {
        val agent = client.agents.create(
            CreateAgentRequest(
                name = agentName,
                model = AgentModelConfig(
                    provider = AgentModelConfigProvider.OPENAI_COMPAT,
                    modelRef = "gpt-4o-mini",
                    capabilities = JsonObject(emptyMap()),
                ),
            )
        )
        createdId = agent.agentId
        created = agent.agentId.isNotEmpty()
    } catch (error: ApiException) {
        createError = error.status
    } catch (error: DecodingException) {
        System.err.println("created: ${error.message}")
        created = DECODE_FAILED
    }

    //  6. read it back, then 7. remove it again
    var nameRoundTrips: Any? = null
    var deleted: Boolean? = null
    var deleteError = 0
    createdId?.let { id ->
        nameRoundTrips = try {
            client.agents.get(id).name == agentName
        } catch (error: DecodingException) {
            System.err.println("name_round_trips: ${error.message}")
            DECODE_FAILED
        }
        deleted = try {
            client.agents.delete(id)
            true
        } catch (error: ApiException) {
            deleteError = error.status
            false
        }
    }

    //  8. cursor pagination, stopped by the caller after six items
    var seen = 0
    var pagedDecoded = true
    try {
        client.agents.listAll(limit = 2).take(6).collect { seen += 1 }
    } catch (error: DecodingException) {
        System.err.println("paged_items: ${error.message}")
        pagedDecoded = false
    }

    val report = buildJsonObject {
        put("language", LANGUAGE)
        put("health", health)
        put("role", me.role)
        put("auth_method", me.authMethod.value)
        when (val size = pageSize) {
            is Int -> put("page_size", size)
            else -> put("page_size", size.toString())
        }
        put("not_found_status", notFoundStatus)
        put("problem_has_title", problemHasTitle)
        when (val made = created) {
            is Boolean -> put("created", made)
            else -> put("created", made.toString())
        }
        if (createError != 0) put("create_error", createError)
        when (val round = nameRoundTrips) {
            null -> Unit
            is Boolean -> put("name_round_trips", round)
            else -> put("name_round_trips", round.toString())
        }
        deleted?.let { put("deleted", it) }
        if (deleteError != 0) put("delete_error", deleteError)
        if (pagedDecoded) put("paged_items", seen) else put("paged_items", DECODE_FAILED)
    }
    println(report)
}
