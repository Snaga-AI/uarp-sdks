package ai.snaga.uarp

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import okio.BufferedSource
import kotlin.math.pow
import kotlin.random.Random

/** One decoded `text/event-stream` frame. */
public data class ServerEvent(
    /** `id:` field (or the `event_id` carried inside a JSON payload), replayed
     *  as `Last-Event-ID` when the stream reconnects. */
    val id: String? = null,
    /** `event:` field; defaults to `message` or, when absent, to the `type`
     *  field inside a JSON data payload. */
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

/** Reconnection and lifecycle behaviour for [sseFlow]. All fields default to a
 *  generic, spec-compliant SSE stream; the platform-specific knobs (terminal
 *  events, an inactivity watchdog, `retry:` pacing) are opt-in so a caller that
 *  passes nothing gets standard SSE. */
public data class StreamOptions(
    /** Reconnect (replaying `Last-Event-ID`) when the stream ends. Default `true`. */
    val reconnect: Boolean = true,
    /** Reconnect attempts without progress before giving up. Default `5`. */
    val maxReconnects: Int = 5,
    /** Event names that complete the flow WITHOUT reconnecting. Empty by default:
     *  a generic stream reconnects on end and lets the caller stop it. The
     *  platform's run stream passes `done`, `run.completed`, `run.failed`,
     *  `team_run_done` (and deliberately NOT `run_done`, which the public replay
     *  route re-emits on connect). A group fan-in passes only `team_run_done`. */
    val terminalEvents: Set<String> = emptySet(),
    /** Max silence between lines before the socket is presumed dead and a
     *  reconnect is attempted. `null` disables the watchdog (a read timeout, or
     *  EOF, owns liveness instead). The platform sets this to 300 s: collapsing
     *  it with EOF made a silently-dead socket look like a finished stream and
     *  the chat went permanently quiet. */
    val inactivityTimeoutMillis: Long? = null,
    /** Base reconnect interval in ms; a `retry:` field overrides it per stream. */
    val baseRetryMillis: Long = 2_000,
    /** Cap on the reconnect backoff. */
    val maxBackoffMillis: Long = 8_000,
    /** Reconnect budget resets after this long connected without a disconnect,
     *  so a long healthy stream doesn't carry "this is the Nth retry" baggage. */
    val stabilityResetMillis: Long = 60_000,
    /** Optional connection-lifecycle observer. Fired on the same dispatcher the
     *  flow runs on (IO by default); the callback must be thread-safe. `Disconnected`
     *  is NOT fired when the caller cancels the flow — only on a natural end. */
    val onState: ((StreamState) -> Unit)? = null,
)

/** Connection-lifecycle states reported by [sseFlow] via [StreamOptions.onState]. */
public sealed interface StreamState {
    /** About to open (or reopen) the HTTP connection. Fired once, before the first attempt. */
    public data object Connecting : StreamState
    /** The server answered 200 and the stream is being read. */
    public data object Connected : StreamState
    /** Waiting on backoff before a reconnect attempt. [attempt] is 1-based. */
    public data class Reconnecting(val attempt: Int) : StreamState
    /** The flow ended without the caller cancelling it (terminal frame, `[DONE]`, or the reconnect budget exhausted). */
    public data object Disconnected : StreamState
}

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
 *
 * The decoder handles the three wire shapes the platform emits: standard
 * `text/event-stream` frames (`event:`/`id:`/`data:`/`retry:`, blank-line
 * dispatch), a JSON object carried in an SSE comment
 * (`:{"type":"…","event_id":"…"}`), and a bare NDJSON line
 * (`{"type":"…","event_id":"…"}`). A `data: [DONE]` frame is a hard terminal:
 * any pending event is flushed and the flow completes without reconnecting.
 */
public fun sseFlow(client: UarpClient, spec: RequestSpec): Flow<ServerEvent> = flow {
    val options = spec.options.stream
    var lastEventId: String? = null
    var attempt = 0
    var baseRetry = options.baseRetryMillis

    options.onState?.invoke(StreamState.Connecting)

    reconnect@ while (currentCoroutineContext().isActive) {
        if (attempt > 0) {
            options.onState?.invoke(StreamState.Reconnecting(attempt))
            delay(streamBackoff(attempt, baseRetry, options.maxBackoffMillis))
            if (!currentCoroutineContext().isActive) break@reconnect
        }

        // On reconnect, replace any spec-supplied `Last-Event-ID` with the id
        // the last delivered event carried, so the stream resumes from there.
        val resumed = lastEventId
        val headers = buildList {
            for ((name, value) in spec.headers) {
                if (resumed != null && name.equals("Last-Event-ID", ignoreCase = true)) continue
                add(name to value)
            }
            resumed?.let { add("Last-Event-ID" to it) }
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
            if (!options.reconnect || attempt >= options.maxReconnects) {
                throw ConnectionException(error.message ?: "could not open event stream", error)
            }
            attempt++
            continue@reconnect
        }

        if (!response.isSuccessful) {
            val body = response.use { it.body?.string().orEmpty() }
            val problem = ApiException(response.code, parseProblem(body), response.headers.toMap(), body.ifBlank { null })
            // 401 always surfaces so the caller can act on it (the app treats it
            // as "stop the stream"); any other HTTP error retries like a dropped
            // connection while the reconnect budget lasts, then surfaces.
            if (response.code == 401 || !options.reconnect || attempt >= options.maxReconnects) throw problem
            attempt++
            continue@reconnect
        }

        options.onState?.invoke(StreamState.Connected)

        // A connection that delivered at least one event counts as progress and
        // resets the reconnect budget; one that closed immediately does not, so
        // a flapping server cannot spin this loop.
        var delivered = false
        var terminal = false
        response.use { open ->
            val source = open.body?.source() ?: throw StreamException("event stream response has no body")
            val parser = SseParser()
            val connectedAt = System.currentTimeMillis()

            read@ while (currentCoroutineContext().isActive) {
                val line = if (options.inactivityTimeoutMillis != null) {
                    withTimeoutOrNull(options.inactivityTimeoutMillis) {
                        runCatching { source.readUtf8Line() }.getOrNull()
                    }
                } else {
                    runCatching { source.readUtf8Line() }.getOrNull()
                }

                if (line == null && !source.isOpen) break@read
                if (line == null) {
                    val eof = runCatching { source.exhausted() }.getOrDefault(true)
                    if (eof) break@read
                    // Inactivity watchdog: the socket is silent but not closed.
                    // Reconnect with `Last-Event-ID` rather than treating the
                    // silence as a finished stream.
                    if (!options.reconnect || attempt >= options.maxReconnects) break@read
                    attempt++
                    continue@reconnect
                }

                // A healthy connection that survived the stability window
                // shouldn't carry "this is the Nth retry" baggage into its next
                // disconnect.
                if (attempt > 0 &&
                    System.currentTimeMillis() - connectedAt >= options.stabilityResetMillis
                ) {
                    attempt = 0
                }

                val event = parser.feed(line)
                // `data: [DONE]` may return a flushed pending event OR null,
                // but either way it sets `isDone` — so check it here, before the
                // `?: continue` would skip the terminal test on a null return.
                if (parser.isDone) {
                    if (event != null) {
                        if (event.id != null) lastEventId = event.id
                        event.retry?.takeIf { it > 0 }?.let { baseRetry = it }
                        delivered = true
                        emit(event)
                    }
                    terminal = true
                    break@read
                }
                val dispatched = event ?: continue@read
                if (dispatched.id != null) lastEventId = dispatched.id
                dispatched.retry?.takeIf { it > 0 }?.let { baseRetry = it }
                delivered = true
                emit(dispatched)
                if (dispatched.event in options.terminalEvents) {
                    terminal = true
                    break@read
                }
            }

            parser.finish()?.let { event ->
                if (event.id != null) lastEventId = event.id
                delivered = true
                if (event.event in options.terminalEvents || parser.isDone) terminal = true
                emit(event)
            }
        }

        if (!currentCoroutineContext().isActive) break@reconnect
        if (terminal) break@reconnect

        // A clean EOF without a terminal frame is a proxy/socket drop mid-run,
        // not a finished stream — reconnect with `Last-Event-ID`.
        if (delivered) attempt = 0
        if (!options.reconnect || attempt >= options.maxReconnects) break@reconnect
        attempt++
    }

    // Only a natural end reports Disconnected — a caller that cancelled the
    // flow has already decided it is done.
    if (currentCoroutineContext().isActive) options.onState?.invoke(StreamState.Disconnected)
}.flowOn(Dispatchers.IO)

/** Half-deterministic, half-random backoff: `maxSleep/2 + rand(0..maxSleep/2)`,
 *  so it climbs with attempts but clients don't all wake on the same boundary. */
internal fun streamBackoff(attempt: Int, baseIntervalMillis: Long, maxDelayMillis: Long): Long {
    val exponential = baseIntervalMillis * 2.0.pow((attempt - 1).coerceAtLeast(0))
    val maxSleep = minOf(maxDelayMillis.toDouble(), exponential)
    val half = (maxSleep / 2).coerceAtLeast(1.0)
    return (half + Random.nextDouble(0.0, half)).toLong().coerceAtLeast(0)
}

/**
 * Line-oriented `text/event-stream` decoder. Handles the three wire shapes the
 * platform emits and the `[DONE]` hard terminal; a frame with no `data:` is not
 * a deliverable event (an `id:`-only frame only updates the last event id).
 */
internal class SseParser {
    private val data = mutableListOf<String>()
    private var event = ""
    private var id: String? = null
    private var retry: Long? = null
    private var hasFields = false
    private var done = false

    /** `true` once a `data: [DONE]` frame arrived — the flow terminates without
     *  reconnecting. */
    val isDone: Boolean get() = done

    /** Feed one line; returns an event when a frame is complete. */
    fun feed(line: String): ServerEvent? {
        if (line.isEmpty()) return dispatch()

        // SSE comment. The platform also carries a JSON payload in a comment
        // (`:{"type":"…","event_id":"…"}`); that is a self-contained frame.
        // A bare comment is a keep-alive.
        if (line.startsWith(":")) {
            val body = line.drop(1).trim()
            if (body.startsWith("{")) return inlineEvent(body)
            return null
        }

        // Bare NDJSON line — a self-contained frame with no field prefix.
        if (line.startsWith("{")) return inlineEvent(line)

        val separator = line.indexOf(':')
        val field = if (separator == -1) line else line.substring(0, separator)
        val value = if (separator == -1) "" else line.substring(separator + 1).removePrefix(" ")

        hasFields = true
        when (field) {
            "event" -> event = value
            "data" -> {
                if (value == "[DONE]") {
                    done = true
                    // Flush a pending event, if any; `[DONE]` itself carries no
                    // payload.
                    return if (data.isNotEmpty() || event.isNotEmpty() || id != null) dispatch() else null
                }
                data += value
            }
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
        val joined = data.joinToString("\n")
        // A frame with no data is not a deliverable event: an `id:`/`retry:`-only
        // frame updates state but carries nothing to emit.
        if (joined.isEmpty()) {
            reset()
            return null
        }
        val resolved = event.ifEmpty { extractEventType(joined) } ?: "message"
        val result = ServerEvent(id = id, event = resolved, data = joined, retry = retry)
        reset()
        return result
    }

    /** A comment-JSON or NDJSON frame: type and id live inside the JSON body. */
    private fun inlineEvent(body: String): ServerEvent =
        ServerEvent(
            id = extractField(body, "event_id"),
            event = extractEventType(body) ?: "message",
            data = body,
        )

    private fun reset() {
        data.clear()
        event = ""
        id = null
        retry = null
        hasFields = false
        // `id` is per-frame: the platform's client resets it on dispatch, so an
        // event's id is only the `id:` its own frame carried (or the `event_id`
        // inside a JSON payload). The flow captures the emitted id for replay
        // before this runs, so reconnect still resumes from the last event id.
    }
}

/**
 * Pull one string field out of a JSON body WITHOUT fully decoding it — the
 * stream carries thousands of frames a minute, and a full parse per frame to
 * learn its `type` is the difference between a smooth stream and a stuttering
 * one. Honours escaped quotes so a `"` inside a value can't fool it.
 */
internal fun extractField(json: String, field: String): String? {
    val needle = "\"$field\""
    val start = json.indexOf(needle)
    if (start < 0) return null
    var i = start + needle.length
    while (i < json.length && (json[i] == ':' || json[i] == ' ')) i++
    if (i >= json.length || json[i] != '"') return null
    i++
    val valueStart = i
    while (i < json.length) {
        when {
            json[i] == '\\' -> {
                i++
                if (i >= json.length) break
            }
            json[i] == '"' -> break
        }
        i++
    }
    if (i <= valueStart) return null
    return json.substring(valueStart, i)
}

/** The `type` field of a JSON frame, peeked without decoding. */
internal fun extractEventType(json: String): String? = extractField(json, "type")