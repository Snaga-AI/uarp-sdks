import XCTest
@testable import UARP

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
        let client = makeClient()
        MockURLProtocol.handler = { request in
            (MockURLProtocol.response(request, status: 403),
             jsonData(["type": "about:blank", "title": "Forbidden", "status": 403]))
        }

        do {
            for try await _ in client.runs.streamRunEvents(runId: "r1") {}
            XCTFail("expected a failure")
        } catch let UARPError.api(error) {
            XCTAssertEqual(error.kind, .permissionDenied)
        }
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
}
