package ai.snaga.uarp

import ai.snaga.uarp.api.agents
import ai.snaga.uarp.api.files
import ai.snaga.uarp.api.registry
import ai.snaga.uarp.api.runs
import ai.snaga.uarp.models.GetMeResponseAuthMethod
import ai.snaga.uarp.models.CreateAgentRequest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.encodeToString
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.io.File
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

/** A complete `Agent` payload: models decode strictly. */
private fun agentJson(id: String) = """
    {
      "agent_id": "$id",
      "tenant_id": "t1",
      "name": "demo",
      "model": {"provider": "openai_compat", "model_ref": "gpt-x", "capabilities": {}},
      "created_at": "2026-01-01T00:00:00Z"
    }
""".trimIndent()

//  The platform picks the model itself and ignores anything sent for it, so a
//  create is just a name.
private fun createAgentRequest() = CreateAgentRequest(name = "demo")

class TransportTest {
    private lateinit var server: MockWebServer

    @BeforeTest
    fun start() {
        server = MockWebServer()
        server.start()
    }

    @AfterTest
    fun stop() {
        server.shutdown()
    }

    private fun client(maxRetries: Int = 0): UarpClient =
        UarpClient.builder()
            .apiKey("uarp_test1234_secret")
            .baseUrl(server.url("/").toString().trimEnd('/'))
            .maxRetries(maxRetries)
            .build()

    private fun json(body: String, status: Int = 200, headers: Map<String, String> = emptyMap()): MockResponse {
        val response = MockResponse().setResponseCode(status)
            .setHeader("Content-Type", "application/json")
            .setBody(body)
        headers.forEach { (name, value) -> response.setHeader(name, value) }
        return response
    }

    @Test
    fun `sends auth and user agent`() = runTest {
        server.enqueue(json("""{"items":[],"cursor":null,"has_more":false}"""))

        client().agents.list()

        val recorded = server.takeRequest()
        assertEquals("Bearer uarp_test1234_secret", recorded.getHeader("Authorization"))
        assertEquals("application/json", recorded.getHeader("Accept"))
        assertTrue(recorded.getHeader("User-Agent")!!.startsWith("uarp-sdk-kotlin/"))
    }

    @Test
    fun `serialises query parameters and skips nulls`() = runTest {
        server.enqueue(json("""{"items":[],"cursor":null,"has_more":false}"""))

        client().agents.list(limit = 25, includeOffline = true)

        val url = server.takeRequest().requestUrl!!
        assertEquals("25", url.queryParameter("limit"))
        assertEquals("true", url.queryParameter("include_offline"))
        assertNull(url.queryParameter("cursor"))
        assertNull(url.queryParameter("workspace_id"))
    }

    @Test
    fun `percent-encodes path parameters`() = runTest {
        server.enqueue(json(agentJson("x")))

        client().agents.get("id with/slash")

        assertEquals("/api/v1/agents/id%20with%2Fslash", server.takeRequest().path)
    }

    @Test
    fun `attaches an idempotency key to writes only`() = runTest {
        server.enqueue(json(agentJson("a1"), status = 201))
        server.enqueue(json("""{"items":[],"cursor":null,"has_more":false}"""))

        val client = client()
        client.agents.create(createAgentRequest())
        client.agents.list()

        assertNotNull(server.takeRequest().getHeader("Idempotency-Key"))
        assertNull(server.takeRequest().getHeader("Idempotency-Key"))
    }

    @Test
    fun `reuses a caller-supplied idempotency key`() = runTest {
        server.enqueue(json(agentJson("a1"), status = 201))

        client().agents.create(createAgentRequest(), options = RequestOptions(idempotencyKey = "fixed-key"))

        assertEquals("fixed-key", server.takeRequest().getHeader("Idempotency-Key"))
    }

    @Test
    fun `sends a json body`() = runTest {
        server.enqueue(json(agentJson("a1"), status = 201))

        val agent = client().agents.create(createAgentRequest())

        assertEquals("a1", agent.agentId)
        val recorded = server.takeRequest()
        assertTrue(recorded.getHeader("Content-Type")!!.startsWith("application/json"))
        assertTrue(recorded.body.readUtf8().contains("\"name\":\"demo\""))
    }

    @Test
    fun `retries 429 and honours retry-after`() = runTest {
        server.enqueue(json("""{"title":"Too Many Requests","status":429}""", 429, mapOf("Retry-After" to "0")))
        server.enqueue(json(agentJson("a1")))

        val agent = client(maxRetries = 2).agents.get("a1")

        assertEquals("a1", agent.agentId)
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `builds a multipart body`() = runTest {
        server.enqueue(
            json(
                """
                {"scope":"@demo","name":"bundle","version":"1.0.0","publisher_tenant_id":"t1",
                 "manifest":{"name":"demo"},"sha256":"abc123","size_bytes":3,
                 "visibility":"public","published_at":"2026-01-01T00:00:00Z"}
                """.trimIndent(),
                201,
            ),
        )

        client().registry.registryPublish(
            ai.snaga.uarp.models.RegistryPublishRequest(
                manifest = """{"name":"demo"}""",
                artifact = FilePart(
                    filename = "bundle.tar.zst",
                    data = byteArrayOf(0x00, 0xFF.toByte(), 0x41),
                    contentType = "application/zstd",
                ),
                sha256 = "abc123",
            ),
        )

        val recorded = server.takeRequest()
        assertTrue(
            recorded.getHeader("Content-Type")!!.startsWith("multipart/form-data; boundary="),
            recorded.getHeader("Content-Type"),
        )

        val body = recorded.body.readByteArray()
        val text = String(body, Charsets.ISO_8859_1)
        assertTrue(text.contains("""name="manifest""""), text)
        assertTrue(text.contains("""name="artifact"; filename="bundle.tar.zst""""), text)
        assertTrue(text.contains("application/zstd"), text)
        assertTrue(text.contains("""name="sha256""""), text)
        //  An optional part the caller left out must not appear at all.
        assertFalse(text.contains("attestation"), text)
        //  The raw bytes must survive, NUL and high byte included.
        assertTrue(
            body.toList().windowed(3).any { it == listOf<Byte>(0x00, 0xFF.toByte(), 0x41) },
            "file bytes were altered",
        )
    }

    @Test
    fun `downloads bytes verbatim`() = runTest {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/octet-stream")
                .setBody(okio.Buffer().write(byteArrayOf(0x00, 0xFF.toByte(), 0x41, 0x00, 0x42))),
        )

        val bytes = client().files.downloadFileContent("f1")

        assertEquals(listOf<Byte>(0x00, 0xFF.toByte(), 0x41, 0x00, 0x42), bytes.toList())
    }

    @Test
    fun `honours the no-retry hint`() = runTest {
        //  A 500 is normally retried; the header has to win.
        server.enqueue(
            json("""{"title":"boom","status":500}""", 500, mapOf("X-Should-Retry" to "false", "Retry-After" to "0")),
        )

        val error = assertFailsWith<ApiException> { client(maxRetries = 3).agents.get("a1") }

        assertEquals(500, error.status)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `reopens a finished stream with the last event id`() = runTest {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("id: 7\nevent: first\ndata: {}\n\n"),
        )
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("event: resumed\ndata: {}\n\n"),
        )

        val names = client().runs.streamRunEvents("r1")
            .take(2)
            .toList()
            .map { it.event }

        assertEquals(listOf("first", "resumed"), names)
        assertNull(server.takeRequest().getHeader("Last-Event-ID"))
        //  The second connection has to replay the id the first one delivered.
        assertEquals("7", server.takeRequest().getHeader("Last-Event-ID"))
    }

    @Test
    fun `does not retry a write that carries no idempotency key`() = runTest {
        server.enqueue(json("""{"title":"boom","status":500}""", 500, mapOf("Retry-After" to "0")))

        //  Outside /api/v1 the transport adds no key, so replaying the write
        //  would risk performing it twice.
        val error = assertFailsWith<ApiException> {
            client(maxRetries = 3).request<kotlinx.serialization.json.JsonElement>(
                RequestSpec(method = "POST", path = "/experimental/thing", body = Body.Json("{}")),
            )
        }

        assertEquals(500, error.status)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `can carry the key in the query for event streams`() = runTest {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("event: run.completed\ndata: {}\n\n"),
        )

        //  Browser proxies that strip Authorization need the key in the URL.
        val streaming = UarpClient.builder()
            .apiKey("uarp_secret")
            .baseUrl(server.url("/").toString().trimEnd('/'))
            .sseTokenInQuery(true)
            .build()
        val options = RequestOptions(stream = StreamOptions(reconnect = false))
        streaming.runs.streamRunEvents("r1", options = options).toList()

        assertEquals("uarp_secret", server.takeRequest().requestUrl!!.queryParameter("token"))
    }

    /**
     * A client whose credentials travel another way.
     *
     * `Bearer ` with nothing after it is NOT the same as sending no header: a
     * server that validates the value can refuse it. TypeScript and Swift
     * already draw this line; these pin it for Kotlin so the family agrees.
     */
    @Test
    fun `an explicitly empty apiKey sends no Authorization header`() = runTest {
        server.enqueue(json("""{"items":[],"cursor":null,"has_more":false}"""))

        val keyless = UarpClient.builder()
            .apiKey("")
            .baseUrl(server.url("/").toString().trimEnd('/'))
            .build()
        keyless.agents.list()

        assertNull(server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `a keyless client puts no token in the SSE query`() = runTest {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("event: run.completed\ndata: {}\n\n"),
        )

        val keyless = UarpClient.builder()
            .apiKey("")
            .baseUrl(server.url("/").toString().trimEnd('/'))
            .sseTokenInQuery(true)
            .build()
        val options = RequestOptions(stream = StreamOptions(reconnect = false))
        keyless.runs.streamRunEvents("r1", options = options).toList()

        //  `?token=` empty is a credential the server then rejects, so the
        //  parameter must be absent entirely rather than present and blank.
        assertNull(server.takeRequest().requestUrl!!.queryParameter("token"))
    }

    @Test
    fun `a set but empty UARP_API_KEY is still a missing key`() {
        //  Going keyless is a deliberate act on the builder. An empty env var
        //  is the environment's version of forgetting to set it. Only assert
        //  when the ambient environment actually has it empty-or-unset, since
        //  a test cannot portably mutate its own environment on the JVM.
        val ambient = System.getenv("UARP_API_KEY")
        if (ambient == null || ambient.isEmpty()) {
            assertFailsWith<ConfigurationException> { UarpClient.fromEnvironment() }
        }
    }

    @Test
    fun `leaves the key out of the query by default`() = runTest {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("event: run.completed\ndata: {}\n\n"),
        )

        val options = RequestOptions(stream = StreamOptions(reconnect = false))
        client().runs.streamRunEvents("r1", options = options).toList()

        assertNull(server.takeRequest().requestUrl!!.queryParameter("token"))
    }

    @Test
    fun `surfaces rate limit hints from the headers`() = runTest {
        server.enqueue(
            json(
                """{"title":"Too Many Requests","status":429}""",
                429,
                mapOf(
                    "Retry-After" to "1.5",
                    "X-RateLimit-Remaining" to "0",
                    "X-Correlation-Id" to "corr-9",
                ),
            ),
        )

        //  No retries, or the transport would swallow the 429 under inspection.
        val error = assertFailsWith<ApiException> { client().agents.get("a1") }

        assertEquals(ApiErrorKind.RATE_LIMIT, error.kind)
        assertEquals(1.5, error.retryAfterSeconds)
        assertEquals(0, error.rateLimitRemaining)
        //  Falls back to the header when the body carries no correlationId.
        assertEquals("corr-9", error.correlationId)
        assertTrue(error.isRetryable)
    }

    @Test
    fun `maps 404 without retrying`() = runTest {
        server.enqueue(
            json(
                """{"type":"about:blank","title":"Not Found","status":404,"detail":"no such agent","correlationId":"corr-1"}""",
                404,
            ),
        )

        val error = assertFailsWith<ApiException> { client(maxRetries = 3).agents.get("missing") }

        assertEquals(ApiErrorKind.NOT_FOUND, error.kind)
        assertEquals("corr-1", error.correlationId)
        assertTrue(error.message!!.contains("no such agent"))
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `exposes validation errors`() = runTest {
        server.enqueue(
            json(
                """{"title":"Unprocessable Entity","status":422,"errors":[{"field":"name","message":"required"}]}""",
                422,
            ),
        )

        val error = assertFailsWith<ApiException> { client().agents.create(createAgentRequest()) }

        assertEquals(ApiErrorKind.UNPROCESSABLE_ENTITY, error.kind)
        assertEquals("name", error.validationErrors.single().field)
    }

    @Test
    fun `listAll stops when a server repeats a cursor`() = runTest {
        //  A server that never clears its cursor would page forever.
        repeat(4) {
            server.enqueue(json("""{"items":[${agentJson("a$it")}],"cursor":"same","has_more":true}"""))
        }

        val ids = client().agents.listAll().toList().map { it.agentId }

        assertEquals(listOf("a0", "a1"), ids)
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `listAll follows the cursor`() = runTest {
        server.enqueue(json("""{"items":[${agentJson("a1")}],"cursor":"next","has_more":true}"""))
        server.enqueue(json("""{"items":[${agentJson("a2")}],"cursor":null,"has_more":false}"""))

        val ids = client().agents.listAll(limit = 1).toList().map { it.agentId }

        assertEquals(listOf("a1", "a2"), ids)
        assertNull(server.takeRequest().requestUrl!!.queryParameter("cursor"))
        assertEquals("next", server.takeRequest().requestUrl!!.queryParameter("cursor"))
    }

    @Test
    fun `streams server-sent events`() = runTest {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("id: 1\nevent: llm.chunk\ndata: {\"text\":\"he\"}\n\nevent: run.completed\ndata: {}\n\n"),
        )

        // Reconnect is on by default; this stub only answers once.
        val options = RequestOptions(stream = StreamOptions(reconnect = false))
        val events = client().runs.streamRunEvents("r1", options = options).toList().map { it.event }

        assertEquals(listOf("llm.chunk", "run.completed"), events)
        assertEquals("text/event-stream", server.takeRequest().getHeader("Accept"))
    }

    @Test
    fun `stream surfaces http errors`() = runTest {
        server.enqueue(json("""{"title":"Forbidden","status":403}""", 403))

        val options = RequestOptions(stream = StreamOptions(reconnect = false))
        val error = assertFailsWith<ApiException> { client().runs.streamRunEvents("r1", options = options).toList() }

        assertEquals(ApiErrorKind.PERMISSION_DENIED, error.kind)
    }

    @Test
    fun `a terminal event completes the flow without reconnecting`() = runTest {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("event: run.completed\ndata: {}\n\n"),
        )

        val options = RequestOptions(
            stream = StreamOptions(terminalEvents = setOf("run.completed")),
        )
        val events = client().runs.streamRunEvents("r1", options = options).toList()

        assertEquals(listOf("run.completed"), events.map { it.event })
        // Reconnect is on by default, but the terminal frame must win — one request.
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `reports connection lifecycle via onState`() = runTest {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("event: run.completed\ndata: {}\n\n"),
        )
        val states = mutableListOf<StreamState>()
        val options = RequestOptions(
            stream = StreamOptions(
                terminalEvents = setOf("run.completed"),
                onState = { states += it },
            ),
        )
        client().runs.streamRunEvents("r1", options = options).toList()

        assertEquals(
            listOf(StreamState.Connecting, StreamState.Connected, StreamState.Disconnected),
            states,
        )
    }

    @Test
    fun `a DONE frame terminates without reconnecting`() = runTest {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("data: {\"text\":\"hi\"}\n\ndata: [DONE]\n\n"),
        )

        val options = RequestOptions(stream = StreamOptions())
        val events = client().runs.streamRunEvents("r1", options = options).toList()

        assertEquals(1, events.size)
        assertEquals("""{"text":"hi"}""", events[0].data)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `decodes a mixed-format platform trace through the full flow`() = runTest {
        // The platform interleaves three wire shapes on one socket — a JSON
        // object in an SSE comment, a bare NDJSON line, a standard frame — and
        // closes with `data: [DONE]`. All three must decode to events with the
        // right type and id, and `[DONE]` must terminate without a reconnect.
        // This is the no-device proof that the SSE migration lost no frame: a
        // parser that dropped comments or unknown lines (the stock SDK parser)
        // would emit only the standard frame here.
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody(
                    """
                    :{"type":"status","event_id":"evt_1","status":"running"}
                    {"type":"token","event_id":"evt_2","text":"hi"}
                    event: token
                    data: {"text":"there"}

                    data: [DONE]

                    """.trimIndent(),
                ),
        )

        val events = client().runs.streamRunEvents("r1").toList()

        assertEquals(3, events.size)
        // comment-JSON: type and id live inside the JSON body.
        assertEquals("status", events[0].event)
        assertEquals("evt_1", events[0].id)
        // bare NDJSON: likewise.
        assertEquals("token", events[1].event)
        assertEquals("evt_2", events[1].id)
        // standard frame: `event:` line + `data:` line; id is per-frame only.
        assertEquals("token", events[2].event)
        assertEquals("""{"text":"there"}""", events[2].data)
        assertNull(events[2].id)
        // `[DONE]` terminated the flow — no reconnect attempt.
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `resumes from the last event id after a mid-stream drop`() = runTest {
        // First response: two standard frames carrying ids, then a clean EOF
        // with no terminal frame — a proxy drop mid-run, not a finished stream.
        // The flow reconnects and replays the last delivered id as
        // `Last-Event-ID`; the second response's terminal frame ends the flow.
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("id: a\ndata: one\n\nid: b\ndata: two\n\n"),
        )
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("event: run.completed\ndata: {}\n\n"),
        )

        val options = RequestOptions(stream = StreamOptions(terminalEvents = setOf("run.completed")))
        val events = client().runs.streamRunEvents("r1", options = options).toList()

        assertEquals(listOf("one", "two", "{}"), events.map { it.data })
        assertEquals(2, server.requestCount)
        // The reconnect carried the last delivered id, not the spec's original.
        server.takeRequest() // original
        val replay = server.takeRequest()
        assertEquals("b", replay.getHeader("Last-Event-ID"))
    }

    // The inactivity watchdog is exercised only on a real blocking socket; under
    // `runTest` the test scheduler owns virtual time while the flow blocks on a
    // real `readUtf8Line` on Dispatchers.IO, so the two clocks never meet. It is
    // a faithful port of the production app's proven 300 s watchdog and is left
    // to integration coverage rather than a flaky virtual-time test.

    @Test
    fun `decodes unknown enum values`() {
        val decoded = uarpJson.decodeFromString<List<GetMeResponseAuthMethod>>(
            """["brand_new"]""",
        )
        assertEquals("brand_new", decoded[0].value)
    }

    @Test
    fun `keeps properties the model does not declare`() {
        val payload = """
            {"tool_calls_count":3,"llm_calls":1,"unmodelled":{"nested":true},"extra_count":7}
        """.trimIndent()

        val decoded = uarpJson.decodeFromString<ai.snaga.uarp.models.BridgeTaskEventMetrics>(payload)
        assertEquals(3L, decoded.toolCallsCount)
        assertEquals(setOf("unmodelled", "extra_count"), decoded.additionalProperties.keys)

        // And they survive the trip back out.
        val reencoded = uarpJson.encodeToString(decoded)
        assertTrue(reencoded.contains("\"extra_count\":7"), reencoded)
        assertTrue(reencoded.contains("\"tool_calls_count\":3"), reencoded)
    }

    @Test
    fun `builder requires an api key`() {
        assertFailsWith<ConfigurationException> { UarpClient.builder().build() }
    }

    @Test
    fun `encodes path segments`() {
        assertEquals("plain-id_1.2~3", encodePathSegment("plain-id_1.2~3"))
        assertEquals("id%20with%2Fslash", encodePathSegment("id with/slash"))
        assertEquals("%D0%B0%D0%B3%D0%B5%D0%BD%D1%82", encodePathSegment("агент"))
    }
}

/** Unit tests for the frame decoder, independent of HTTP. */
class SseParserTest {
    private fun parse(lines: List<String>): List<ServerEvent> {
        val parser = SseParser()
        val events = lines.mapNotNull { parser.feed(it) }.toMutableList()
        parser.finish()?.let { events += it }
        return events
    }

    @Test
    fun `parses a simple frame`() {
        val events = parse(listOf("event: run.started", """data: {"run_id":"r1"}""", ""))
        assertEquals(1, events.size)
        assertEquals("run.started", events[0].event)
        assertEquals("""{"run_id":"r1"}""", events[0].data)
    }

    @Test
    fun `defaults the event name and joins data lines`() {
        val events = parse(listOf("data: one", "data: two", ""))
        assertEquals("message", events[0].event)
        assertEquals("one\ntwo", events[0].data)
    }

    @Test
    fun `ignores comments and unknown fields`() {
        val events = parse(listOf(": keep-alive", "foo: bar", "data: hello", ""))
        assertEquals(1, events.size)
        assertEquals("hello", events[0].data)
    }

    @Test
    fun `keeps the id field`() {
        assertEquals("42", parse(listOf("id: 42", "data: x", ""))[0].id)
    }

    @Test
    fun `flushes an unterminated frame`() {
        val events = parse(listOf("event: partial", "data: x"))
        assertEquals(1, events.size)
        assertEquals("partial", events[0].event)
    }

    @Test
    fun `decodes a json payload carried in a comment`() {
        val body = """{"type":"llm.chunk","event_id":"e7","text":"hi"}"""
        val events = parse(listOf(":$body"))
        assertEquals(1, events.size)
        assertEquals("llm.chunk", events[0].event)
        assertEquals("e7", events[0].id)
        assertEquals(body, events[0].data)
    }

    @Test
    fun `decodes a bare ndjson line`() {
        val body = """{"type":"tool.started","event_id":"e9"}"""
        val events = parse(listOf(body))
        assertEquals(1, events.size)
        assertEquals("tool.started", events[0].event)
        assertEquals("e9", events[0].id)
        assertEquals(body, events[0].data)
    }

    @Test
    fun `falls back to the type field inside data when no event line`() {
        val events = parse(listOf("""data: {"type":"run.completed"}""", ""))
        assertEquals(1, events.size)
        assertEquals("run.completed", events[0].event)
    }

    @Test
    fun `data DONE flushes a pending event and signals done`() {
        val parser = SseParser()
        // A `data:` line alone does not dispatch (no blank line); it accumulates.
        assertNull(parser.feed("""data: {"text":"he"}"""))
        // `[DONE]` flushes the accumulated chunk and signals done.
        val flushed = parser.feed("data: [DONE]")
        assertEquals("""{"text":"he"}""", flushed?.data)
        // Nothing is left unterminated.
        assertNull(parser.finish())
        assertTrue(parser.isDone)
    }

    @Test
    fun `data DONE with nothing pending emits nothing`() {
        val parser = SseParser()
        val done = parser.feed("data: [DONE]")
        assertNull(done)
        assertNull(parser.finish())
        assertTrue(parser.isDone)
    }

    @Test
    fun `an id-only frame emits nothing`() {
        val events = parse(listOf("id: 5", ""))
        assertEquals(0, events.size)
    }

    @Test
    fun `id is per frame not persisted across frames`() {
        val events = parse(listOf("id: 1", """data: {"x":1}""", "", """data: {"x":2}""", ""))
        assertEquals(2, events.size)
        assertEquals("1", events[0].id)
        assertNull(events[1].id)
    }

    @Test
    fun `streamBackoff climbs with attempts and stays bounded`() {
        val max = 8_000L
        // attempt 1: base*2^0 = 2000 -> maxSleep 2000 -> [1000, 2000)
        val a1 = streamBackoff(1, 2_000, max)
        // attempt 5: base*2^4 = 32000, capped at max -> maxSleep 8000 -> [4000, 8000)
        val a5 = streamBackoff(5, 2_000, max)
        assertTrue(a1 in 1_000 until 2_000, a1.toString())
        assertTrue(a5 in 4_000 until 8_000, a5.toString())
        assertTrue(a5 > a1)
    }

    @Test
    fun `decodes the shared mixed-format fixture to the locked expected output`() {
        // contract/sse-fixtures/mixed.txt + .expected.json is the cross-language
        // decode-parity subject: the four other SDK ports replay the same bytes
        // and must match this output. Kotlin is the source of truth, so this test
        // locks the expected file — if either drifts, the other ports disagree.
        val parser = SseParser()
        val actual = fixtureText("mixed.txt").split('\n')
            .mapNotNull { parser.feed(it) }
            .toMutableList<ServerEvent>()
        parser.finish()?.let { actual += it }

        val expected = Json { ignoreUnknownKeys = true }
            .decodeFromString<List<ExpectedEvent>>(fixtureText("mixed.expected.json"))

        assertEquals(expected.size, actual.size, "event count")
        actual.zip(expected).forEachIndexed { i, (a, e) ->
            assertEquals(e.id, a.id, "event[$i].id")
            assertEquals(e.event, a.event, "event[$i].event")
            assertEquals(e.data, a.data, "event[$i].data")
            assertEquals(e.retry, a.retry, "event[$i].retry")
        }
        // The fixture closes with `data: [DONE]`; the decoder must signal it.
        assertTrue(parser.isDone, "fixture should terminate with [DONE]")
    }
}

/** One row of the shared decode-parity fixture's expected output. */
@Serializable
private data class ExpectedEvent(
    val id: String? = null,
    val event: String,
    val data: String,
    val retry: Long? = null,
)

/** Read a file from contract/sse-fixtures, searching a few likely working dirs. */
private fun fixtureText(name: String): String {
    val candidates = listOf(
        File("contract/sse-fixtures", name),
        File("../../contract/sse-fixtures", name),
        File("../../../contract/sse-fixtures", name),
    )
    return candidates.firstOrNull { it.exists() }?.readText()
        ?: error("SSE fixture $name not found; tried ${candidates.map { it.absolutePath }}")
}

/**
 * A failure the server did not phrase as RFC 9457 must still reach the caller.
 *
 * Every field of [Problem] is nullable with a default and the decoder ignores
 * unknown keys, so a bare `{"error": "..."}` decoded successfully into an empty
 * `Problem` and the raw-body fallback was unreachable for exactly the input it
 * was written for. 32 API handlers answer with that shape.
 */
class ProblemDecodingTest {
    @Test
    fun `bare error key keeps its message`() {
        val p = parseProblem("""{"error": "Insufficient role: owner required"}""")
        assertEquals("Insufficient role: owner required", p.detail)
    }

    @Test
    fun `nested error message keeps its message`() {
        assertEquals("Upstream error", parseProblem("""{"error": {"message": "Upstream error"}}""").detail)
    }

    @Test
    fun `a real problem document is used as is`() {
        val p = parseProblem("""{"type":"about:blank","title":"Not Found","status":404,"detail":"no such agent"}""")
        assertEquals("Not Found", p.title)
        assertEquals("no such agent", p.detail)
        assertEquals(404, p.status)
    }

    @Test
    fun `a non-JSON body is not thrown away`() {
        val p = parseProblem("<html><body>502 Bad Gateway</body></html>")
        assertTrue(p.detail!!.contains("Bad Gateway"))
    }
}
