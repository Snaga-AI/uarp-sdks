package ai.snaga.uarp

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.JsonElement
import okio.BufferedSource

/** One decoded `text/event-stream` frame. */
public data class ServerEvent(
    /** `id:` field, replayed as `Last-Event-ID` when the stream reconnects. */
    val id: String? = null,
    /** `event:` field; defaults to `message`. */
    val event: String = "message",
    /** Concatenated `data:` lines, without the trailing newline. */
    val data: String = "",
    /** `retry:` field in milliseconds. */
    val retry: Long? = null,
) {
    /** Parse [data] as JSON. */
    public fun json(): JsonElement = uarpJson.parseToJsonElement(data)

    /** Decode [data] into [T]. */
    public inline fun <reified T> decode(): T =
        try {
            uarpJson.decodeFromString<T>(data)
        } catch (error: Exception) {
            throw DecodingException("failed to decode event payload: ${error.message}", data, error)
        }
}

/** Reconnection behaviour for [sseFlow]. */
public data class StreamOptions(
    /** Reconnect (replaying `Last-Event-ID`) when the stream ends. Default `true`. */
    val reconnect: Boolean = true,
    /** Reconnect attempts without progress before giving up. Default `5`. */
    val maxReconnects: Int = 5,
)

/**
 * A cold [Flow] of server-sent events.
 *
 * ```kotlin
 * client.runs.streamRunEvents(runId).collect { event ->
 *     if (event.event == "run.completed") throw CancellationException()
 * }
 * ```
 *
 * Cancelling the collector closes the HTTP connection.
 */
public fun sseFlow(client: UarpClient, spec: RequestSpec): Flow<ServerEvent> = flow {
    val options = spec.options.stream
    var lastEventId: String? = null
    var attempt = 0

    while (true) {
        val headers = buildList {
            addAll(spec.headers)
            lastEventId?.let { add("Last-Event-ID" to it) }
        }
        val query = if (client.sseTokenInQuery) spec.query + ("token" to client.apiKey) else spec.query
        // Streams are long-lived: the unary call timeout would cut them short.
        val attemptSpec = spec.copy(
            headers = headers,
            query = query,
            options = spec.options.copy(timeoutMillis = 0),
        )

        val request = client.buildRequest(attemptSpec, idempotencyKey = null, accept = "text/event-stream")
        val response = try {
            client.httpFor(attemptSpec.options).newCall(request).await()
        } catch (error: IOException) {
            throw ConnectionException(error.message ?: "could not open event stream", error)
        }

        if (!response.isSuccessful) {
            val body = response.use { it.body?.string().orEmpty() }
            throw ApiException(response.code, parseProblem(body), response.headers.toMap(), body.ifBlank { null })
        }

        // A connection that delivered at least one event counts as progress and
        // resets the reconnect budget; one that closed immediately does not, so
        // a flapping server cannot spin this loop.
        var delivered = false
        response.use { open ->
            val source = open.body?.source() ?: throw StreamException("event stream response has no body")
            val parser = SseParser()
            source.forEachLine { line ->
                val event = parser.feed(line) ?: return@forEachLine
                if (event.id != null) lastEventId = event.id
                delivered = true
                emit(event)
            }
            parser.finish()?.let { event ->
                if (event.id != null) lastEventId = event.id
                delivered = true
                emit(event)
            }
        }
        if (delivered) attempt = 0

        if (!options.reconnect || attempt >= options.maxReconnects) return@flow
        delay(backoffMillis(attempt))
        attempt++
    }
}.flowOn(Dispatchers.IO)

/** Read UTF-8 lines from a streaming body until it closes. */
private inline fun BufferedSource.forEachLine(action: (String) -> Unit) {
    while (true) {
        val line = readUtf8Line() ?: return
        action(line)
    }
}

/** Line-oriented `text/event-stream` decoder. */
internal class SseParser {
    private val data = mutableListOf<String>()
    private var event = ""
    private var id: String? = null
    private var retry: Long? = null
    private var hasFields = false

    /** Feed one line; returns an event when the frame is complete. */
    fun feed(line: String): ServerEvent? {
        if (line.isEmpty()) return dispatch()
        if (line.startsWith(":")) return null // comment / keep-alive

        val separator = line.indexOf(':')
        val field = if (separator == -1) line else line.substring(0, separator)
        val value = if (separator == -1) "" else line.substring(separator + 1).removePrefix(" ")

        hasFields = true
        when (field) {
            "event" -> event = value
            "data" -> data += value
            "id" -> if (!value.contains('\u0000')) id = value
            "retry" -> retry = value.toLongOrNull()
            else -> Unit // unknown fields are ignored
        }
        return null
    }

    /** Flush a frame left unterminated when the connection closed. */
    fun finish(): ServerEvent? = dispatch()

    private fun dispatch(): ServerEvent? {
        if (!hasFields) return null
        val result = ServerEvent(
            id = id,
            event = event.ifEmpty { "message" },
            data = data.joinToString("\n"),
            retry = retry,
        )
        data.clear()
        event = ""
        retry = null
        hasFields = false
        return result
    }
}
