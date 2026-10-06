import XCTest
@testable import UARPSDK

final class StreamingTests: XCTestCase {
    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    // MARK: - Parser

    private func parse(_ lines: [String]) -> [ServerEvent] {
        var parser = SSEParser()
        var events: [ServerEvent] = []
        for line in lines {
            if let event = parser.feed(line) { events.append(event) }
        }
        if let event = parser.finish() { events.append(event) }
        return events
    }

    func testParsesASimpleFrame() {
        let events = parse(["event: run.started", #"data: {"run_id":"r1"}"#, ""])
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].event, "run.started")
        XCTAssertEqual(events[0].data, #"{"run_id":"r1"}"#)
    }

    func testDefaultsEventNameAndJoinsData() {
        let events = parse(["data: one", "data: two", ""])
        XCTAssertEqual(events[0].event, "message")
        XCTAssertEqual(events[0].data, "one\ntwo")
    }

    func testIgnoresCommentsAndUnknownFields() {
        let events = parse([": keep-alive", "foo: bar", "data: hello", ""])
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].data, "hello")
    }

    func testKeepsTheIdField() {
        let events = parse(["id: 42", "data: x", ""])
        XCTAssertEqual(events[0].id, "42")
    }

    func testFlushesAnUnterminatedFrame() {
        let events = parse(["event: partial", "data: x"])
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].event, "partial")
    }

    func testDecodesEventPayload() throws {
        let events = parse([#"data: {"text":"hi"}"#, ""])
        struct Chunk: Decodable { let text: String }
        XCTAssertEqual(try events[0].json(as: Chunk.self).text, "hi")
    }

    // MARK: - End to end

    func testStreamsRunEvents() async throws {
        let client = makeClient()
        let body = "id: 1\nevent: llm.chunk\ndata: {\"text\":\"he\"}\n\nevent: run.completed\ndata: {}\n\n"
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/event-stream"]
            )!
            return (response, Data(body.utf8))
        }

        var names: [String] = []
        for try await event in client.runs.streamRunEvents(runId: "r1") {
            names.append(event.event)
            if event.event == "run.completed" { break }
        }

        XCTAssertEqual(names, ["llm.chunk", "run.completed"])
        XCTAssertEqual(MockURLProtocol.requests[0].value(forHTTPHeaderField: "Accept"), "text/event-stream")
    }

    func testStreamSurfacesHTTPErrors() async throws {
        // Non-401 HTTP errors now retry within the reconnect budget before
        // surfacing, so disable reconnect to assert the error is raised at all.
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 403),
             jsonData(["type": "about:blank", "title": "Forbidden", "status": 403]))
        }

        do {
            for try await _ in client.runs.streamRunEvents(
                runId: "r1",
                options: RequestOptions(stream: StreamOptions(reconnect: false))
            ) {}
            XCTFail("expected a failure")
        } catch let UARPError.api(error) {
            XCTAssertEqual(error.kind, .permissionDenied)
        }
        XCTAssertEqual(MockURLProtocol.requests.count, 1)
    }

    func testReopensAFinishedStreamWithTheLastEventId() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/event-stream"]
            )!
            if let resumed = request.value(forHTTPHeaderField: "Last-Event-ID") {
                return (response, Data("event: resumed.\(resumed)\ndata: {}\n\n".utf8))
            }
            return (response, Data("id: 7\nevent: first\ndata: {}\n\n".utf8))
        }

        var names: [String] = []
        for try await event in client.runs.streamRunEvents(runId: "r1") {
            names.append(event.event)
            if event.event.hasPrefix("resumed.") { break }
        }

        // The second connection has to replay the id the first one delivered.
        XCTAssertEqual(names, ["first", "resumed.7"])
        XCTAssertNil(MockURLProtocol.requests[0].value(forHTTPHeaderField: "Last-Event-ID"))
        XCTAssertEqual(MockURLProtocol.requests[1].value(forHTTPHeaderField: "Last-Event-ID"), "7")
    }

    func testCarriesTheKeyInTheQueryWhenAsked() async throws {
        // Browser proxies that strip Authorization need the key in the URL.
        var configuration = Configuration(apiKey: "uarp_secret", baseURL: URL(string: "https://api.example.test")!)
        configuration.sseTokenInQuery = true
        let client = UARPClient(configuration: configuration, session: MockURLProtocol.session())

        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/event-stream"]
            )!
            return (response, Data("event: run.completed\ndata: {}\n\n".utf8))
        }

        _ = try await client.runs.streamRunEvents(runId: "r1").until { $0.event == "run.completed" }

        let components = URLComponents(url: MockURLProtocol.requests[0].url!, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(components.queryItems?.first { $0.name == "token" }?.value, "uarp_secret")
    }

    func testLeavesTheKeyOutOfTheQueryByDefault() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/event-stream"]
            )!
            return (response, Data("event: run.completed\ndata: {}\n\n".utf8))
        }

        _ = try await client.runs.streamRunEvents(runId: "r1").until { $0.event == "run.completed" }

        let url = MockURLProtocol.requests[0].url!.absoluteString
        XCTAssertFalse(url.contains("token="), url)
    }

    func testUntilStopsAtTheFirstMatch() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/event-stream"]
            )!
            return (response, Data("event: a\ndata: 1\n\nevent: done\ndata: 2\n\n".utf8))
        }

        let event = try await client.runs.streamRunEvents(runId: "r1").until { $0.event == "done" }
        XCTAssertEqual(event?.data, "2")
    }

    // MARK: - Decode parity (Kotlin-locked fixture)

    func testDecodesMixedFormatFixtureToLockedExpectedOutput() throws {
        // contract/sse-fixtures/mixed.txt + .expected.json is the cross-language
        // decode-parity subject: every SDK port replays the same bytes and must
        // match. Kotlin locks the expected file; if this test fails, the decoder
        // diverged — fix the decoder, not the expected file.
        //
        // This test file lives at apps/sdk/packages/swift/Tests/UARPTests/; the
        // fixture at apps/sdk/contract/sse-fixtures/ — five directories up.
        let fixtureDir = URL(fileURLWithPath: #file)
            .deletingLastPathComponent()  // UARPTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // swift
            .deletingLastPathComponent()  // packages
            .deletingLastPathComponent()  // sdk
            .appendingPathComponent("contract/sse-fixtures")
        let mixedBytes = try Data(contentsOf: fixtureDir.appendingPathComponent("mixed.txt"))
        let expectedData = try Data(contentsOf: fixtureDir.appendingPathComponent("mixed.expected.json"))

        struct ExpectedEvent: Decodable {
            let id: String?
            let event: String
            let data: String
            let retry: Int?
        }
        let expected = try JSONDecoder().decode([ExpectedEvent].self, from: expectedData)

        var parser = SSEParser()
        var actual: [ServerEvent] = []
        for line in String(decoding: mixedBytes, as: UTF8.self)
            .split(separator: "\n", omittingEmptySubsequences: false) {
            if let event = parser.feed(String(line)) { actual.append(event) }
        }
        if let event = parser.finish() { actual.append(event) }

        XCTAssertEqual(actual.count, expected.count, "event count")
        for (i, (a, e)) in zip(actual, expected).enumerated() {
            XCTAssertEqual(a.id, e.id, "event[\(i)].id")
            XCTAssertEqual(a.event, e.event, "event[\(i)].event")
            XCTAssertEqual(a.data, e.data, "event[\(i)].data")
            XCTAssertEqual(a.retry, e.retry, "event[\(i)].retry")
        }
        // The fixture closes with `data: [DONE]`; the decoder must signal it.
        XCTAssertTrue(parser.isDone, "fixture should terminate with [DONE]")
    }

    // MARK: - Reconnect behaviour

    private func sseResponse(for request: URLRequest) -> HTTPURLResponse {
        HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "text/event-stream"]
        )!
    }

    func testTerminalEventCompletesWithoutReconnecting() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (self.sseResponse(for: request), Data("event: run.completed\ndata: {}\n\n".utf8))
        }

        var names: [String] = []
        for try await event in client.runs.streamRunEvents(
            runId: "r1",
            options: RequestOptions(stream: StreamOptions(terminalEvents: ["run.completed"]))
        ) {
            names.append(event.event)
        }

        XCTAssertEqual(names, ["run.completed"])
        XCTAssertEqual(MockURLProtocol.requests.count, 1, "terminal event must not reconnect")
    }

    func testDoneFrameTerminatesWithoutReconnecting() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (self.sseResponse(for: request), Data("data: {\"text\":\"hi\"}\n\ndata: [DONE]\n\n".utf8))
        }

        var datas: [String] = []
        for try await event in client.runs.streamRunEvents(runId: "r1") {
            datas.append(event.data)
        }

        XCTAssertEqual(datas, ["{\"text\":\"hi\"}"])
        XCTAssertEqual(MockURLProtocol.requests.count, 1, "[DONE] must not reconnect")
    }

    func testInactivityWatchdogReconnectsSilentSocketWithLastEventId() async throws {
        // A socket that delivers one frame then goes silent (never finishes
        // loading, never sends more) must be presumed dead by the watchdog and
        // reconnected, replaying the last delivered id as `Last-Event-ID`.
        let client = makeClient()
        let firstFrame = Data("id: 1\nevent: llm.chunk\ndata: {\"text\":\"he\"}\n\n".utf8)
        let secondFrame = Data("event: run.completed\ndata: {}\n\n".utf8)
        MockURLProtocol.streamingHandler = { proto, request in
            proto.client?.urlProtocol(proto, didReceive: self.sseResponse(for: request), cacheStoragePolicy: .notAllowed)
            if MockURLProtocol.requests.count == 1 {
                proto.client?.urlProtocol(proto, didLoad: firstFrame)
                // Silent: deliberately do NOT call didFinishLoading.
            } else {
                proto.client?.urlProtocol(proto, didLoad: secondFrame)
                proto.client?.urlProtocolDidFinishLoading(proto)
            }
        }

        var names: [String] = []
        for try await event in client.runs.streamRunEvents(
            runId: "r1",
            options: RequestOptions(stream: StreamOptions(
                terminalEvents: ["run.completed"],
                inactivityTimeoutMillis: 50,
                baseRetryMillis: 1,
                maxBackoffMillis: 2
            ))
        ) {
            names.append(event.event)
        }

        XCTAssertEqual(names, ["llm.chunk", "run.completed"])
        XCTAssertEqual(MockURLProtocol.requests.count, 2, "silent socket must trigger a reconnect")
        XCTAssertNil(MockURLProtocol.requests[0].value(forHTTPHeaderField: "Last-Event-ID"), "first attempt carries no resume id")
        XCTAssertEqual(MockURLProtocol.requests[1].value(forHTTPHeaderField: "Last-Event-ID"), "1", "reconnect replays the last delivered id")
    }

    func test401SurfacesWithoutRetrying() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 401),
             jsonData(["type": "about:blank", "title": "Unauthorized", "status": 401]))
        }

        do {
            for try await _ in client.runs.streamRunEvents(runId: "r1") {}
            XCTFail("expected a failure")
        } catch let UARPError.api(error) {
            XCTAssertEqual(error.status, 401)
        }
        XCTAssertEqual(MockURLProtocol.requests.count, 1, "401 must not retry")
    }

    func testReportsConnectionLifecycleViaOnState() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (self.sseResponse(for: request), Data("event: run.completed\ndata: {}\n\n".utf8))
        }

        // `onState` is a `@Sendable` closure, so it cannot capture a mutable
        // `var` — Swift 6 strict concurrency (the CI runner's language mode)
        // rejects that even when a looser local toolchain does not. A small
        // `NSLock`-backed `Sendable` cell locks synchronously, which a
        // non-async callback needs, and is available at the package's
        // deployment target (macOS 12 / iOS 15), unlike `OSAllocatedUnfairLock`.
        let states = LockedBox([StreamState]())
        for try await _ in client.runs.streamRunEvents(
            runId: "r1",
            options: RequestOptions(stream: StreamOptions(
                terminalEvents: ["run.completed"],
                onState: { state in states.mutate { $0.append(state) } }
            ))
        ) {}

        XCTAssertEqual(states.snapshot, [.connecting, .connected, .disconnected])
    }

    // MARK: - streamPost

    private let chatBody: JSONObject = [
        "model": "contract/model",
        "stream": true,
        "messages": .array([.object(["role": "user", "content": "hi"])]),
    ]

    private let firstChunk = #"{"choices":[{"index":0,"delta":{"content":"he"}}]}"#
    private let secondChunk = #"{"choices":[{"index":0,"delta":{"content":"llo"}}]}"#

    func testStreamPostSendsTheBodyAndStopsAtDone() async throws {
        let client = makeClient(maxRetries: 2)
        let frames = "data: \(firstChunk)\n\ndata: \(secondChunk)\n\ndata: [DONE]\n\n"
        MockURLProtocol.handler = { request in
            (self.sseResponse(for: request), Data(frames.utf8))
        }

        var datas: [String] = []
        for try await event in client.streamPost(path: "/api/v1/llm/chat/completions", body: chatBody) {
            datas.append(event.data)
        }

        XCTAssertEqual(datas, [firstChunk, secondChunk], "two chunks, and [DONE] is not an event")
        XCTAssertEqual(MockURLProtocol.requests.count, 1)
        let request = MockURLProtocol.requests[0]
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.absoluteString, "https://api.example.test/api/v1/llm/chat/completions")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer uarp_test1234_secret")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "text/event-stream")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let key = try XCTUnwrap(request.value(forHTTPHeaderField: "Idempotency-Key"))
        XCTAssertNotNil(UUID(uuidString: key), key)
        let body = try XCTUnwrap(request.httpBody ?? request.httpBodyStream.map(readBody))
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: body), .object(chatBody))
    }

    func testStreamPostStopsAtDoneEvenWhenTheConnectionStaysOpen() async throws {
        // The body above closes right after [DONE], so it cannot tell
        // "stopped at [DONE]" from "stopped at the end of the body".
        let client = makeClient()
        let frames = "data: \(firstChunk)\n\ndata: [DONE]\n\n"
        MockURLProtocol.streamingHandler = { proto, request in
            proto.client?.urlProtocol(proto, didReceive: self.sseResponse(for: request), cacheStoragePolicy: .notAllowed)
            proto.client?.urlProtocol(proto, didLoad: Data(frames.utf8))
            // Deliberately no didFinishLoading: the socket stays open.
        }

        var datas: [String] = []
        // The watchdog only turns a regression into a failure instead of a hang.
        let options = RequestOptions(stream: StreamOptions(inactivityTimeoutMillis: 2000))
        for try await event in client.streamPost(path: "/api/v1/llm/chat/completions", body: chatBody, options: options) {
            datas.append(event.data)
        }

        XCTAssertEqual(datas, [firstChunk])
        XCTAssertEqual(MockURLProtocol.requests.count, 1)
    }

    func testStreamPostRefusalIsAnAPIErrorAndIsNotRetried() async throws {
        // A 429 is retried everywhere else in the SDK; replaying this POST
        // would run, and bill, the model twice.
        let client = makeClient(maxRetries: 2)
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 429,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/problem+json", "Retry-After": "0"]
            )!
            return (response, jsonData(["title": "Too Many Requests", "status": 429, "detail": "llm quota exhausted"]))
        }

        var delivered = 0
        do {
            for try await _ in client.streamPost(path: "/api/v1/llm/chat/completions/refused", body: chatBody) {
                delivered += 1
            }
            XCTFail("expected a failure")
        } catch let UARPError.api(error) {
            XCTAssertEqual(error.status, 429)
            XCTAssertEqual(error.problem.title, "Too Many Requests")
            XCTAssertEqual(error.problem.detail, "llm quota exhausted")
        }
        XCTAssertEqual(delivered, 0, "the refusal body is not an event")
        XCTAssertEqual(MockURLProtocol.requests.count, 1, "a streamed POST is never retried")
    }

    func testStreamPostRejectsAPlainJSONAnswer() async throws {
        // The body left out "stream": true. Read as a stream, the JSON line
        // would come out as one bogus event.
        let client = makeClient(maxRetries: 2)
        let plain = #"{"choices":[{"index":0,"message":{"role":"assistant","content":"hello"}}]}"#
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 200), Data(plain.utf8))
        }

        var delivered = 0
        do {
            for try await _ in client.streamPost(path: "/api/v1/llm/chat/completions/plain", body: chatBody) {
                delivered += 1
            }
            XCTFail("a 2xx that is not an event stream must be an error")
        } catch let UARPError.api(error) {
            XCTAssertEqual(error.status, 200)
            XCTAssertEqual(error.problem.detail, plain, "the body is kept")
        }
        XCTAssertEqual(delivered, 0)
        XCTAssertEqual(MockURLProtocol.requests.count, 1)
    }

    func testStreamPostRejectsAnEmptyAnswer() async throws {
        // Read as a stream, this would end cleanly with no events: an answer
        // that never came, reading as a finished one.
        let client = makeClient(maxRetries: 2)
        MockURLProtocol.handler = { request in
            (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [:])!, Data())
        }

        var delivered = 0
        do {
            for try await _ in client.streamPost(path: "/api/v1/llm/chat/completions", body: chatBody) {
                delivered += 1
            }
            XCTFail("a 2xx that is not an event stream must be an error")
        } catch let UARPError.api(error) {
            XCTAssertEqual(error.status, 200)
        }
        XCTAssertEqual(delivered, 0)
        XCTAssertEqual(MockURLProtocol.requests.count, 1)
    }

    func testRecognisesAnEventStreamContentType() {
        XCTAssertTrue(isEventStream("text/event-stream"))
        XCTAssertTrue(isEventStream("Text/Event-Stream; charset=utf-8"))
        XCTAssertFalse(isEventStream("application/json"))
        XCTAssertFalse(isEventStream("text/event-streams"))
        XCTAssertFalse(isEventStream(""))
        XCTAssertFalse(isEventStream(nil))
    }

    func testStreamPostEndsAtTheEndOfTheBodyWithoutReconnecting() async throws {
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (self.sseResponse(for: request), Data("data: \(self.firstChunk)\n\n".utf8))
        }

        var datas: [String] = []
        for try await event in client.streamPost(path: "/api/v1/llm/chat/completions", body: chatBody) {
            datas.append(event.data)
            // A reopened stream would deliver the chunk again, and forever:
            // fail on the second copy rather than hang.
            if datas.count > 1 { break }
        }

        XCTAssertEqual(datas, [firstChunk])
        XCTAssertEqual(MockURLProtocol.requests.count, 1, "a streamed POST is never reopened")
    }

    func testStreamPostThrowsWhenTheConnectionDropsMidStream() async throws {
        // Nothing resumes this stream, so a quiet end would hand the caller a
        // truncated answer that looks complete.
        let client = makeClient()
        MockURLProtocol.streamingHandler = { proto, request in
            proto.client?.urlProtocol(proto, didReceive: self.sseResponse(for: request), cacheStoragePolicy: .notAllowed)
            proto.client?.urlProtocol(proto, didLoad: Data("data: \(self.firstChunk)\n\n".utf8))
            proto.client?.urlProtocol(proto, didFailWithError: URLError(.networkConnectionLost))
        }

        do {
            for try await _ in client.streamPost(path: "/api/v1/llm/chat/completions", body: chatBody) {}
            XCTFail("a dropped connection must not read as the end of the answer")
        } catch UARPError.connection {}
        XCTAssertEqual(MockURLProtocol.requests.count, 1, "a streamed POST is never reopened")
    }

    private func readBody(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}

/// A tiny `Sendable` mutable cell for capturing stream-lifecycle state from a
/// `@Sendable` callback in tests. `NSLock` is available at the package's
/// deployment target (macOS 12 / iOS 15); `@unchecked Sendable` is sound
/// because every access goes through `lock`.
private final class LockedBox<T>: @unchecked Sendable {
    private var value: T
    private let lock = NSLock()

    init(_ value: T) { self.value = value }

    func mutate(_ body: (inout T) -> Void) {
        lock.lock(); defer { lock.unlock() }
        body(&value)
    }

    var snapshot: T {
        lock.lock(); defer { lock.unlock() }
        return value
    }
}
