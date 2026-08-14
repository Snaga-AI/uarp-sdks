package ai.snaga.uarp

import ai.snaga.uarp.api.agents
import ai.snaga.uarp.api.runs
import ai.snaga.uarp.models.AgentModelConfig
import ai.snaga.uarp.models.AgentModelConfigProvider
import ai.snaga.uarp.models.CreateAgentRequest
import ai.snaga.uarp.models.CreateRunRequest
import kotlinx.coroutines.flow.collect
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Create an agent, start a run, follow it live, then page through history.
 *
 * These functions live in the test source set so the compiler keeps the
 * example honest; nothing here runs during `gradlew test`.
 */
object Quickstart {

    suspend fun createAgent(client: UarpClient) =
        client.agents.create(
            CreateAgentRequest(
                name = "quickstart",
                model = AgentModelConfig(
                    provider = AgentModelConfigProvider.OPENAI_COMPAT,
                    modelRef = "gpt-4o-mini",
                    capabilities = JsonObject(emptyMap()),
                ),
                prompts = JsonObject(mapOf("system" to JsonPrimitive("You are concise."))),
            ),
        )

    suspend fun runAndFollow(client: UarpClient, agentId: String) {
        val run = client.runs.create(CreateRunRequest(agentId = agentId))

        // The flow reconnects with Last-Event-ID if the connection drops.
        client.runs.streamRunEvents(run.runId).collect { event ->
            when (event.event) {
                "llm.chunk" -> print(event.data)
                "run.completed", "run.failed" -> throw kotlinx.coroutines.CancellationException("done")
            }
        }
    }

    suspend fun listEverything(client: UarpClient) {
        // `listAll` walks every page; `list` returns one page plus its cursor.
        client.agents.listAll(limit = 50).collect { agent ->
            println("${agent.agentId}  ${agent.name}")
        }
    }

    suspend fun main(client: UarpClient) {
        try {
            val agent = createAgent(client)
            runAndFollow(client, agent.agentId)
            listEverything(client)
        } catch (error: ApiException) {
            when (error.kind) {
                ApiErrorKind.UNPROCESSABLE_ENTITY ->
                    error.validationErrors.forEach { println("invalid ${it.field}: ${it.message}") }
                ApiErrorKind.RATE_LIMIT ->
                    println("rate limited; retry after ${error.retryAfterSeconds}s")
                else -> println("${error.status}: ${error.message}")
            }
        }
    }
}
