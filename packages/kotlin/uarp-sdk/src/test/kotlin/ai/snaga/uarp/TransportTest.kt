package ai.snaga.uarp

import ai.snaga.uarp.api.agents
import ai.snaga.uarp.api.files
import ai.snaga.uarp.api.registry
import ai.snaga.uarp.api.runs
import ai.snaga.uarp.models.AgentModelConfig
import ai.snaga.uarp.models.AgentModelConfigProvider
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

private fun createAgentRequest() = CreateAgentRequest(
    name = "demo",
    model = AgentModelConfig(
        provider = AgentModelConfigProvider.OPENAI_COMPAT,
        modelRef = "gpt-x",
        capabilities = kotlinx.serialization.json.JsonObject(emptyMap()),
    ),
)

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
    fun `decodes unknown enum values`() {
        val config = uarpJson.decodeFromString<AgentModelConfig>(
            """{"provider":"brand_new","model_ref":"m","capabilities":{}}""",
        )
        assertEquals("brand_new", config.provider.value)
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
}
