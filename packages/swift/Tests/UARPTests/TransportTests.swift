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

    /// Real bytes: the 4-byte body `null` that GET /agents/{id}/schedule answered the canon tenant on 2026-10-15 (build b108e9a9) for an agent with no schedule.
    func testAScheduleThatIsNotSetIsNil() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 200), Data("null".utf8))
        }
        let schedule = try await client.scheduler.getSchedule(agentId: "a1")
        XCTAssertNil(schedule)
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

    /// Regression: `UARPClient.buildRequest` used to assign `path` straight to
    /// `URLComponents.percentEncodedPath`. When a caller passed query inline
    /// (e.g. `"runs?limit=50"`), the setter saw a string with a `?` in it,
    /// which is not a valid path, and tripped Foundation's precondition →
    /// `EXC_BAD_INSTRUCTION (SIGILL)` and killed the app at boot. The Client
    /// must strip the query portion before joining the path so the precondition
    /// never fires, and the query string the caller actually wanted is left to
    /// ride on `spec.query` (or in the meantime, silently dropped — better than
    /// a crash).
    func testBuildRequestDoesNotCrashOnInlineQueryInPath() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 200),
             jsonData(["items": [], "cursor": NSNull(), "has_more": false]))
        }

        // The caller — historically some iOS convenience wrappers — bundled
        // the query in `path`. Pre-fix this SIGILL'd before the request ever
        // landed; post-fix the SDK must survive the malformed path and emit
        // a URL whose path contains no `?` at all.
        _ = try await client.sendRaw(RequestSpec(method: "GET", path: "runs?limit=50"))

        let recorded = MockURLProtocol.requests[0]
        XCTAssertEqual(recorded.url?.path, "/runs",
                       "inline query string must NOT leak into the URL path")
        XCTAssertEqual(recorded.url?.query, nil,
                       "and nothing survives as a query string either — the inline form is silently dropped")
    }

    /// Companion to the regression above: if the caller supplies the query
    /// explicitly via `RequestSpec.query`, it must reach the wire as a
    /// properly-encoded query string. `URLQueryItem` leaves `+` alone, so the
    /// SDK encodes by hand — these assertions pin that ordering.
    func testBuildRequestAppliesExplicitQueryItems() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 200),
             jsonData(["items": [], "cursor": NSNull(), "has_more": false]))
        }

        _ = try await client.sendRaw(RequestSpec(
            method: "GET",
            path: "runs",
            query: [URLQueryItem(name: "limit", value: "50")]
        ))

        let recorded = MockURLProtocol.requests[0]
        let components = try XCTUnwrap(URLComponents(url: recorded.url!, resolvingAgainstBaseURL: false))
        let param = try XCTUnwrap(components.queryItems?.first { $0.name == "limit" })
        XCTAssertEqual(param.value, "50")
    }

    // MARK: - Form bodies

    func testSendsAFormBodyByteForByte() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 200), jsonData(["api_key": "uarp_x", "email": "a@b.c"]))
        }

        let session = try await client.auth.completeOAuthLoginFormPost(
            provider: "apple",
            body: CompleteOAuthLoginFormPostRequest(
                code: "c 1+2",
                state: "s/ы&=~*",
                user: #"{"name":"А Б","email":"a@b.c"}"#
            )
        )

        XCTAssertEqual(session.email, "a@b.c")
        let recorded = MockURLProtocol.requests[0]
        XCTAssertEqual(recorded.httpMethod, "POST")
        // The provider is an enum: `String(describing:)` would put
        // `…Provider(rawValue: "apple")` in the path.
        XCTAssertEqual(recorded.url?.absoluteString, "https://api.example.test/api/v1/auth/oauth/apple/callback")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Content-Type"), "application/x-www-form-urlencoded")
        XCTAssertNotNil(recorded.value(forHTTPHeaderField: "Idempotency-Key"))
        let body = try XCTUnwrap(recorded.httpBody ?? recorded.httpBodyStream.map(readAll))
        // What `URLSearchParams` writes for the same fields, in schema order;
        // `id_token` and `error` were not set and do not appear at all.
        XCTAssertEqual(
            String(decoding: body, as: UTF8.self),
            "code=c+1%2B2&state=s%2F%D1%8B%26%3D%7E*&user=%7B%22name%22%3A%22%D0%90+%D0%91%22%2C%22email%22%3A%22a%40b.c%22%7D"
        )
    }

    func testFormEncodingMatchesURLSearchParams() {
        // Every ASCII character from U+0001 and three multi-byte ones; the
        // expected text is what Node's `URLSearchParams` produces for them.
        let ascii = String(String.UnicodeScalarView((1..<128).map { Unicode.Scalar(UInt8($0)) }))
        XCTAssertEqual(
            encodeFormComponent(ascii + "ы😀\u{E9}"),
            "%01%02%03%04%05%06%07%08%09%0A%0B%0C%0D%0E%0F%10%11%12%13%14%15%16%17%18%19%1A%1B%1C%1D%1E%1F"
                + "+%21%22%23%24%25%26%27%28%29*%2B%2C-.%2F0123456789%3A%3B%3C%3D%3E%3F%40"
                + "ABCDEFGHIJKLMNOPQRSTUVWXYZ%5B%5C%5D%5E_%60abcdefghijklmnopqrstuvwxyz%7B%7C%7D%7E%7F"
                + "%D1%8B%F0%9F%98%80%C3%A9"
        )
    }

    func testFormValueWritesNonStringsAsTheirJSON() throws {
        let client = makeClient()
        XCTAssertEqual(try client.formValue(1.0), "1")
        XCTAssertEqual(try client.formValue(["a/b": JSONValue.bool(true)]), #"{"a/b":true}"#)
        XCTAssertEqual(try client.formValue(JSONValue.string("plain")), "plain")
        XCTAssertNil(try client.formValue(JSONValue.null))
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

/// A failure the server did not phrase as RFC 9457 must still reach the caller.
///
/// Every field of `Problem` is optional, so a bare `{"error": "..."}` decoded
/// successfully into an empty `Problem` and the raw-text fallback was
/// unreachable for exactly the input it was written for. 32 API handlers answer
/// with that shape; each one arrived as a failure carrying no message.
final class ProblemDecodingTests: XCTestCase {
    func testBareErrorKeyKeepsItsMessage() {
        let data = Data(#"{"error": "Insufficient role: owner required"}"#.utf8)
        let problem = UARPClient.problem(from: data)
        XCTAssertEqual(problem.detail, "Insufficient role: owner required")
    }

    func testNestedErrorMessageKeepsItsMessage() {
        let data = Data(#"{"error": {"message": "Upstream error"}}"#.utf8)
        XCTAssertEqual(UARPClient.problem(from: data).detail, "Upstream error")
    }

    func testRealProblemDocumentIsUsedAsIs() {
        let data = Data(#"{"type":"about:blank","title":"Not Found","status":404,"detail":"no such agent"}"#.utf8)
        let problem = UARPClient.problem(from: data)
        XCTAssertEqual(problem.title, "Not Found")
        XCTAssertEqual(problem.detail, "no such agent")
        XCTAssertEqual(problem.status, 404)
    }

    func testNonJSONBodyIsNotThrownAway() {
        let data = Data("<html><body>502 Bad Gateway</body></html>".utf8)
        XCTAssertTrue(UARPClient.problem(from: data).detail?.contains("Bad Gateway") == true)
    }

    func testEmptyBodyStaysEmpty() {
        XCTAssertNil(UARPClient.problem(from: Data()).detail)
    }
    /// Real bytes: the 401 production answered on 2026-10-15 with no key and
    /// our own `X-Request-Id`; the 501 `GET /registry/keys` gave the canon
    /// tenant the day before. The 501's code is not in the `ErrorCode` enum and
    /// it carries only the deprecated `correlationId`.
    static let live401 = #"{"type":"about:blank","title":"Unauthorized","status":401,"detail":"Missing Authorization header, token query parameter, or uarp_session cookie","correlationId":"sdk-probe-0001","correlation_id":"sdk-probe-0001","code":"AUTH_ERROR"}"#
    static let canon501 = #"{"type": "about:blank", "title": "Not Implemented", "status": 501, "detail": "Artifact signing is disabled (spec_registry.signing_mode = \"off\").", "code": "SIGNING_NOT_CONFIGURED", "correlationId": "01a13c8d-1f16-732c-8884-727d6fb7bcdb"}"#

    func testAProblemKeepsItsCodeAndRequestId() {
        let data = Data(Self.live401.utf8)
        let error = APIError(status: 401, problem: UARPClient.problem(from: data), headers: [:], body: data)
        XCTAssertEqual(error.code, "AUTH_ERROR")
        XCTAssertEqual(error.correlationId, "sdk-probe-0001")
        XCTAssertEqual(error.problem.extensions, [:])
        XCTAssertEqual(error.body, data)
    }

    func testACodeTheEnumDoesNotListStillReachesTheCaller() {
        let problem = UARPClient.problem(from: Data(Self.canon501.utf8))
        XCTAssertEqual(problem.code, "SIGNING_NOT_CONFIGURED")
        XCTAssertEqual(problem.correlationId, "01a13c8d-1f16-732c-8884-727d6fb7bcdb")
    }

    /// Real bytes: the 422 the session route answers for a closed session, captured by the API lane from handleRequest on the code deployed as b108e9a9 (2026-10-15).
    static let sessionNotActive422 = #"{"type":"about:blank","title":"Validation Error","status":422,"detail":"Session is not active","correlationId":"01a13f4a-fb5a-7d99-9d94-910550f34d83","correlation_id":"01a13f4a-fb5a-7d99-9d94-910550f34d83","code":"SESSION_NOT_ACTIVE","session_status":"closed"}"#

    func testAnExtensionMemberReachesTheCallerBesideTheCode() {
        let problem = UARPClient.problem(from: Data(Self.sessionNotActive422.utf8))
        XCTAssertEqual(problem.code, "SESSION_NOT_ACTIVE")
        XCTAssertEqual(problem.extensions, ["session_status": .string("closed")])
        XCTAssertEqual(problem.correlationId, "01a13f4a-fb5a-7d99-9d94-910550f34d83")
    }

    /// Real bytes: the 403 a refused X-Active-Tenant answers on production, build e0b37b03 (2026-10-17). membership_suspended is the API lane's capture from handleRequest at d6b1c66e5, the same code: producing it on the wire would mean suspending a membership on canon.
    static let notAMember403 = #"{"type":"about:blank","title":"Forbidden","status":403,"detail":"You are not a member of the active tenant requested by X-Active-Tenant","correlationId":"01a14b59-dd54-7a2f-aa6b-e4338e105419","correlation_id":"01a14b59-dd54-7a2f-aa6b-e4338e105419","code":"FORBIDDEN","reason":"not_a_member"}"#
    static let membershipSuspended403 = #"{"type":"about:blank","title":"Forbidden","status":403,"detail":"Your membership in the active tenant requested by X-Active-Tenant is suspended","correlationId":"01a14a66-dcfc-7a98-9221-f40af5b6cd0b","correlation_id":"01a14a66-dcfc-7a98-9221-f40af5b6cd0b","code":"FORBIDDEN","reason":"membership_suspended"}"#
    /// Real bytes: the same refusal on production, build d926b90e (2026-10-17), before batch19: no code and no reason.
    static let notAMember403D926 = #"{"type":"about:blank","title":"Forbidden","status":403,"detail":"You are not a member of the active tenant requested by X-Active-Tenant","correlationId":"01a14a66-337b-7324-9a2a-9354a8fc02c6","correlation_id":"01a14a66-337b-7324-9a2a-9354a8fc02c6"}"#

    func testTheReasonATenantRefusedTheCallerReachesItTyped() {
        func error(_ body: String) -> APIError {
            let data = Data(body.utf8)
            return APIError(status: 403, problem: UARPClient.problem(from: data), headers: [:], body: data)
        }
        XCTAssertEqual(error(Self.notAMember403).code, "FORBIDDEN")
        XCTAssertEqual(error(Self.notAMember403).reason, "not_a_member")
        XCTAssertEqual(error(Self.membershipSuspended403).reason, "membership_suspended")
        XCTAssertNil(error(Self.notAMember403D926).reason)
        XCTAssertNil(error(Self.notAMember403D926).code)
    }

    func testTheRequestIdHeaderIsTheFallback() {
        let data = Data(#"{"type":"about:blank","title":"Not Found","status":404,"detail":"no such agent"}"#.utf8)
        let error = APIError(status: 404, problem: UARPClient.problem(from: data), headers: ["x-request-id": "req-42"])
        XCTAssertEqual(error.correlationId, "req-42")
    }
}
