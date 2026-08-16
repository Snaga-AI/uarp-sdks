import XCTest
@testable import UARPSDK

final class TransportTests: XCTestCase {
    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    func testSendsAuthAndUserAgent() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 200),
             jsonData(["items": [], "cursor": NSNull(), "has_more": false]))
        }

        _ = try await client.agents.list()

        let recorded = MockURLProtocol.requests[0]
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Authorization"), "Bearer uarp_test1234_secret")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertTrue(recorded.value(forHTTPHeaderField: "User-Agent")?.hasPrefix("uarp-sdk-swift/") == true)
    }

    func testSerialisesQueryParametersAndSkipsNil() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 200),
             jsonData(["items": [], "cursor": NSNull(), "has_more": false]))
        }

        _ = try await client.agents.list(limit: 25, includeOffline: true)

        let components = URLComponents(url: MockURLProtocol.requests[0].url!, resolvingAgainstBaseURL: false)!
        let items = components.queryItems ?? []
        XCTAssertEqual(items.first { $0.name == "limit" }?.value, "25")
        XCTAssertEqual(items.first { $0.name == "include_offline" }?.value, "true")
        XCTAssertNil(items.first { $0.name == "cursor" })
        XCTAssertNil(items.first { $0.name == "workspace_id" })
    }

    func testPercentEncodesPathParameters() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 200), jsonData(agentJSON(id: "x")))
        }

        _ = try await client.agents.get(agentId: "id with/slash")

        let path = MockURLProtocol.requests[0].url!.absoluteString
        XCTAssertTrue(path.hasSuffix("/api/v1/agents/id%20with%2Fslash"), path)
    }

    func testAttachesIdempotencyKeyToWritesOnly() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            if request.httpMethod == "POST" {
                return (MockURLProtocol.response(request, status: 201), jsonData(agentJSON(id: "a1")))
            }
            return (MockURLProtocol.response(request, status: 200),
                    jsonData(["items": [], "cursor": NSNull(), "has_more": false]))
        }

        _ = try await client.agents.create(body: createAgentRequest())
        _ = try await client.agents.list()

        let post = MockURLProtocol.requests.first { $0.httpMethod == "POST" }!
        let get = MockURLProtocol.requests.first { $0.httpMethod == "GET" }!
        XCTAssertNotNil(post.value(forHTTPHeaderField: "Idempotency-Key"))
        XCTAssertNil(get.value(forHTTPHeaderField: "Idempotency-Key"))
    }

    func testReusesCallerSuppliedIdempotencyKey() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 201), jsonData(agentJSON(id: "a1")))
        }

        _ = try await client.agents.create(
            body: createAgentRequest(),
            options: RequestOptions(idempotencyKey: "fixed-key")
        )

        XCTAssertEqual(MockURLProtocol.requests[0].value(forHTTPHeaderField: "Idempotency-Key"), "fixed-key")
    }

    func testSendsJSONBody() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 201), jsonData(agentJSON(id: "a1")))
        }

        let agent = try await client.agents.create(body: createAgentRequest())

        XCTAssertEqual(agent.agentId, "a1")
        let recorded = MockURLProtocol.requests[0]
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(recorded.httpBody ?? recorded.httpBodyStream.map(readAll))
        let decoded = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        XCTAssertEqual(decoded?["name"] as? String, "demo")
    }

    func testRetries429AndHonoursRetryAfter() async throws {
        let client = makeClient(maxRetries: 2)
        let counter = Counter()
        MockURLProtocol.handler = { request in
            if counter.next() == 1 {
                return (MockURLProtocol.response(request, status: 429, headers: ["Retry-After": "0"]),
                        jsonData(["title": "Too Many Requests", "status": 429, "type": "about:blank"]))
            }
            return (MockURLProtocol.response(request, status: 200), jsonData(agentJSON(id: "a1")))
        }

        let agent = try await client.agents.get(agentId: "a1")

        XCTAssertEqual(agent.agentId, "a1")
        XCTAssertEqual(MockURLProtocol.requests.count, 2)
    }

    func testHonoursTheNoRetryHint() async throws {
        let client = makeClient(maxRetries: 3)
        MockURLProtocol.handler = { request in
            // A 500 is normally retried; the header has to win.
            (MockURLProtocol.response(request, status: 500, headers: ["X-Should-Retry": "false", "Retry-After": "0"]),
             jsonData(["title": "boom", "status": 500]))
        }

        do {
            _ = try await client.agents.get(agentId: "a1")
            XCTFail("expected a failure")
        } catch let UARPError.api(error) {
            XCTAssertEqual(error.status, 500)
        }
        XCTAssertEqual(MockURLProtocol.requests.count, 1)
    }

    func testSurfacesRateLimitHintsFromTheHeaders() async throws {
        // No retries, or the transport would swallow the 429 under inspection.
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 429, headers: [
                "Retry-After": "1.5",
                "X-RateLimit-Remaining": "0",
                "X-Correlation-Id": "corr-9",
            ]),
             jsonData(["title": "Too Many Requests", "status": 429]))
        }

        do {
            _ = try await client.agents.get(agentId: "a1")
            XCTFail("expected a failure")
        } catch let UARPError.api(error) {
            XCTAssertEqual(error.kind, .rateLimit)
            XCTAssertEqual(error.retryAfterSeconds, 1.5)
            XCTAssertEqual(error.rateLimitRemaining, 0)
            // Falls back to the header when the body carries no correlationId.
            XCTAssertEqual(error.correlationId, "corr-9")
            XCTAssertTrue(error.isRetryable)
        }
    }

    func testMaps404WithoutRetrying() async throws {
        let client = makeClient(maxRetries: 3)
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 404),
             jsonData([
                "type": "about:blank",
                "title": "Not Found",
                "status": 404,
                "detail": "no such agent",
                "correlationId": "corr-1",
             ]))
        }

        do {
            _ = try await client.agents.get(agentId: "missing")
            XCTFail("expected a failure")
        } catch let UARPError.api(error) {
            XCTAssertEqual(error.kind, .notFound)
            XCTAssertEqual(error.correlationId, "corr-1")
            XCTAssertTrue(error.description.contains("no such agent"))
        }
        XCTAssertEqual(MockURLProtocol.requests.count, 1)
    }

    func testExposesValidationErrors() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 422),
             jsonData([
                "type": "about:blank",
                "title": "Unprocessable Entity",
                "status": 422,
                "errors": [["field": "name", "message": "required"]],
             ]))
        }

        do {
            _ = try await client.agents.create(body: createAgentRequest())
            XCTFail("expected a failure")
        } catch let UARPError.api(error) {
            XCTAssertEqual(error.kind, .unprocessableEntity)
            XCTAssertEqual(error.validationErrors.first?.field, "name")
        }
    }

    func testListAllStopsWhenAServerRepeatsACursor() async throws {
        let client = makeClient()
        let counter = Counter()
        MockURLProtocol.handler = { request in
            // A server that never clears its cursor would page forever.
            let index = counter.next()
            return (MockURLProtocol.response(request, status: 200),
                    jsonData(["items": [agentJSON(id: "a\(index)")], "cursor": "same", "has_more": true]))
        }

        var ids: [String] = []
        for try await agent in client.agents.listAll() {
            ids.append(agent.agentId)
        }

        XCTAssertEqual(ids, ["a1", "a2"])
        XCTAssertEqual(MockURLProtocol.requests.count, 2)
    }

    func testListAllFollowsTheCursor() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
            let cursor = components.queryItems?.first { $0.name == "cursor" }?.value
            if cursor == nil {
                return (MockURLProtocol.response(request, status: 200),
                        jsonData(["items": [agentJSON(id: "a1")], "cursor": "next", "has_more": true]))
            }
            return (MockURLProtocol.response(request, status: 200),
                    jsonData(["items": [agentJSON(id: "a2")], "cursor": NSNull(), "has_more": false]))
        }

        var ids: [String] = []
        for try await agent in client.agents.listAll(limit: 1) {
            ids.append(agent.agentId)
        }

        XCTAssertEqual(ids, ["a1", "a2"])
        XCTAssertEqual(MockURLProtocol.requests.count, 2)
    }

    func testBuildsAMultipartBody() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 201), jsonData(publishResponseJSON()))
        }

        _ = try await client.registry.registryPublish(
            body: RegistryPublishRequest(
                manifest: "{\"name\":\"demo\"}",
                artifact: FilePart(
                    filename: "bundle.tar.zst",
                    data: Data([0x00, 0xFF, 0x41]),
                    contentType: "application/zstd"
                ),
                sha256: "abc123"
            )
        )

        let recorded = MockURLProtocol.requests[0]
        let contentType = try XCTUnwrap(recorded.value(forHTTPHeaderField: "Content-Type"))
        XCTAssertTrue(contentType.hasPrefix("multipart/form-data; boundary=uarp-"), contentType)

        let boundary = String(contentType.split(separator: "=", maxSplits: 1)[1])
        // URLProtocol hands the body back as a stream, not as data.
        let body = try XCTUnwrap(recorded.httpBody ?? recorded.httpBodyStream.map(readAll))
        let text = String(decoding: body, as: UTF8.self)

        XCTAssertTrue(text.contains("--\(boundary)\r\n"), "parts must start with the boundary")
        XCTAssertTrue(text.contains("Content-Disposition: form-data; name=\"manifest\"\r\n\r\n{\"name\":\"demo\"}"))
        XCTAssertTrue(text.contains("name=\"artifact\"; filename=\"bundle.tar.zst\""))
        XCTAssertTrue(text.contains("Content-Type: application/zstd"))
        XCTAssertTrue(text.contains("name=\"sha256\"\r\n\r\nabc123"))
        XCTAssertTrue(text.hasSuffix("--\(boundary)--\r\n"), "the body must be closed off")
        // An optional part the caller left out must not appear at all.
        XCTAssertFalse(text.contains("attestation"))
        // The raw bytes must survive, NUL and high byte included.
        XCTAssertTrue(body.range(of: Data([0x00, 0xFF, 0x41])) != nil)
    }

    func testDownloadsBytesVerbatim() async throws {
        let client = makeClient()
        let payload = Data([0x00, 0xFF, 0x41, 0x00, 0x42])
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/octet-stream"]
            )!
            return (response, payload)
        }

        let bytes = try await client.files.downloadFileContent(fileId: "f1")
        XCTAssertEqual(bytes, payload)
    }

    func testDoesNotRetryAWriteWithoutAnIdempotencyKey() async throws {
        let client = makeClient(maxRetries: 3)
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 500, headers: ["Retry-After": "0"]),
             jsonData(["title": "boom", "status": 500]))
        }

        // Outside /api/v1 the transport adds no key, so replaying the write
        // would risk performing it twice.
        do {
            let _: JSONValue = try await client.send(
                RequestSpec(method: "POST", path: "/experimental/thing", body: .json(Data("{}".utf8)))
            )
            XCTFail("expected a failure")
        } catch let UARPError.api(error) {
            XCTAssertEqual(error.status, 500)
        }
        XCTAssertEqual(MockURLProtocol.requests.count, 1)
    }

    func testDecodesUnknownEnumValues() throws {
        //  Wrapped in an array so the decoder is not asked for a top-level
        //  fragment; the point is the enum, not the container.
        let payload = Data(#"["brand_new"]"#.utf8)
        let decoded = try JSONDecoder().decode([GetMeResponseAuthMethod].self, from: payload)
        XCTAssertEqual(decoded[0].rawValue, "brand_new")
        XCTAssertNotEqual(decoded[0], .apiKey)
    }

    func testConfigurationFromEnvironmentRequiresAKey() {
        // The environment of the test process has no UARP_API_KEY set.
        if ProcessInfo.processInfo.environment["UARP_API_KEY"] == nil {
            XCTAssertThrowsError(try Configuration.fromEnvironment())
        }
    }

    func testSendRawReturnsTheNon2xxBodyWithoutThrowing() async throws {
        // The whole point of sendRaw: a refusal answered with a bare
        // `{"error":"…"}` (not an RFC 9457 document) is returned, not thrown,
        // so the caller can decode it through its own decoder.
        let client = makeClient()
        let body = jsonData(["error": "Insufficient role: \"developer\" does not meet required \"admin\""])
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 403), body)
        }

        let (data, http) = try await client.sendRaw(
            RequestSpec(method: "GET", path: "/api/v1/mcp/servers")
        )
        XCTAssertEqual(http.statusCode, 403)
        XCTAssertEqual(data, body)
        XCTAssertEqual(MockURLProtocol.requests.count, 1)
    }

    func testSendRawRetriesTransientFailuresThenReturnsTheTerminalResponse() async throws {
        let client = makeClient(maxRetries: 2)
        let counter = Counter()
        MockURLProtocol.handler = { request in
            if counter.next() == 1 {
                return (MockURLProtocol.response(request, status: 503, headers: ["Retry-After": "0"]),
                        jsonData(["title": "unavailable", "status": 503]))
            }
            return (MockURLProtocol.response(request, status: 200), jsonData(agentJSON(id: "a1")))
        }

        let (data, http) = try await client.sendRaw(
            RequestSpec(method: "GET", path: "/api/v1/agents/a1", idempotent: false)
        )
        XCTAssertEqual(http.statusCode, 200)
        XCTAssertFalse(data.isEmpty)
        XCTAssertEqual(MockURLProtocol.requests.count, 2)
    }

    func testSendRawDoesNotRetryANonRetryableStatus() async throws {
        let client = makeClient(maxRetries: 3)
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 422),
             jsonData(["title": "Unprocessable Entity", "status": 422]))
        }

        let (data, http) = try await client.sendRaw(
            RequestSpec(method: "POST", path: "/api/v1/agents", body: .json(Data("{}".utf8)))
        )
        XCTAssertEqual(http.statusCode, 422)
        XCTAssertFalse(data.isEmpty)
        // A non-retryable status is returned after one attempt, not replayed.
        XCTAssertEqual(MockURLProtocol.requests.count, 1)
    }

    func testEmptyApiKeyOmitsTheAuthorizationHeader() async throws {
        // A guest/public client carries no credentials: an empty apiKey must
        // produce NO Authorization header, not a `Bearer ` with nothing after it.
        let configuration = Configuration(
            apiKey: "",
            baseURL: URL(string: "https://api.example.test")!,
            maxRetries: 0
        )
        let client = UARPClient(configuration: configuration, session: MockURLProtocol.session())
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 200), jsonData(agentJSON(id: "a1")))
        }

        _ = try await client.sendRaw(RequestSpec(method: "GET", path: "/api/v1/agents/a1"))

        XCTAssertNil(MockURLProtocol.requests[0].value(forHTTPHeaderField: "Authorization"))
    }

    private func readAll(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        let size = 4096
        var buffer = [UInt8](repeating: 0, count: size)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: size)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}

/// Thread-safe call counter for stubbed handlers.
final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func next() -> Int {
        lock.withLock {
            value += 1
            return value
        }
    }
}

func createAgentRequest() -> CreateAgentRequest {
    //  The platform picks the model itself and ignores anything sent for it,
    //  so a create is just a name.
    CreateAgentRequest(name: "demo")
}
