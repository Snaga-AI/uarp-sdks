import Foundation

#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One decoded `text/event-stream` frame.
public struct ServerEvent: Sendable, Hashable {
    /// `id:` field, replayed as `Last-Event-ID` when the stream reconnects.
    public let id: String?
    /// `event:` field; defaults to `message`.
    public let event: String
    /// Concatenated `data:` lines, without the trailing newline.
    public let data: String
    /// `retry:` field in milliseconds.
    public let retry: Int?

    public init(id: String? = nil, event: String, data: String, retry: Int? = nil) {
        self.id = id
        self.event = event
        self.data = data
        self.retry = retry
    }

    /// Decode `data` as JSON.
    public func json<T: Decodable>(as type: T.Type = T.self) throws -> T {
        let bytes = Data(data.utf8)
        do {
            return try JSONDecoder().decode(T.self, from: bytes)
        } catch {
            throw UARPError.decoding(underlying: error, body: bytes)
        }
    }
}

/// Reconnection behaviour for ``EventStream``.
public struct StreamOptions: Sendable {
    /// Reconnect (replaying `Last-Event-ID`) when the stream ends. Default `true`.
    public var reconnect: Bool
    /// Reconnect attempts without progress before giving up. Default `5`.
    public var maxReconnects: Int

    public init(reconnect: Bool = true, maxReconnects: Int = 5) {
        self.reconnect = reconnect
        self.maxReconnects = maxReconnects
    }
}

/// A live SSE stream.
///
/// ```swift
/// for try await event in client.runs.streamRunEvents(runId: id) {
///     if event.event == "run.completed" { break }
/// }
/// ```
///
/// Leaving the loop cancels the underlying request.
public struct EventStream: AsyncSequence, Sendable {
    public typealias Element = ServerEvent

    private let client: UARPClient
    private let spec: RequestSpec
    private let options: StreamOptions

    init(client: UARPClient, spec: RequestSpec, options: StreamOptions) {
        self.client = client
        self.spec = spec
        self.options = options
    }

    public func makeAsyncIterator() -> AsyncThrowingStream<ServerEvent, Error>.Iterator {
        makeStream().makeAsyncIterator()
    }

    /// Collect events until `predicate` matches, then stop.
    public func until(_ predicate: @Sendable (ServerEvent) -> Bool) async throws -> ServerEvent? {
        for try await event in self where predicate(event) {
            return event
        }
        return nil
    }

    private func makeStream() -> AsyncThrowingStream<ServerEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    try await run(continuation)
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func run(_ continuation: AsyncThrowingStream<ServerEvent, Error>.Continuation) async throws {
        #if canImport(FoundationNetworking)
        //  swift-corelibs-foundation does not implement `URLSession.bytes(for:)`,
        //  and every other way of reading a response there buffers it to the end
        //  — which never arrives on a stream that stays open. The rest of the
        //  SDK works on Linux; only the eleven event-stream endpoints do not.
        throw UARPError.stream(
            "event streams need URLSession.bytes, which swift-corelibs-foundation does not provide; "
                + "this SDK can stream on Apple platforms only"
        )
        #else
        var lastEventId: String?
        var attempt = 0

        while !Task.isCancelled {
            var attemptSpec = spec
            // A stream is long-lived; the unary timeout would cut it short.
            attemptSpec.options.timeout = spec.options.timeout ?? 86_400
            if let lastEventId {
                attemptSpec.headers["Last-Event-ID"] = lastEventId
            }
            if client.configuration.sseTokenInQuery {
                attemptSpec.query.append(URLQueryItem(name: "token", value: client.configuration.apiKey))
            }

            let request = try client.buildRequest(attemptSpec, idempotencyKey: nil, accept: "text/event-stream")
            let (bytes, response) = try await client.session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw UARPError.connection(underlying: URLError(.badServerResponse))
            }

            guard (200..<300).contains(http.statusCode) else {
                var body = Data()
                for try await byte in bytes { body.append(byte) }
                throw UARPError.api(APIError(
                    status: http.statusCode,
                    problem: UARPClient.problem(from: body),
                    headers: UARPClient.normalizedHeaders(http)
                ))
            }

            // A connection that delivered at least one event counts as progress
            // and resets the reconnect budget; one that closed immediately does
            // not, so a flapping server cannot spin this loop.
            var delivered = false
            var parser = SSEParser()
            // `AsyncLineSequence` drops empty lines, and an empty line is exactly
            // what terminates an SSE frame — so split the byte stream by hand.
            var buffer: [UInt8] = []
            for try await byte in bytes {
                guard byte == 0x0A else {
                    buffer.append(byte)
                    continue
                }
                if buffer.last == 0x0D { buffer.removeLast() }
                let line = String(decoding: buffer, as: UTF8.self)
                buffer.removeAll(keepingCapacity: true)
                guard let event = parser.feed(line) else { continue }
                if event.id != nil { lastEventId = event.id }
                delivered = true
                continuation.yield(event)
            }
            if !buffer.isEmpty {
                if buffer.last == 0x0D { buffer.removeLast() }
                if let event = parser.feed(String(decoding: buffer, as: UTF8.self)) {
                    if event.id != nil { lastEventId = event.id }
                    delivered = true
                    continuation.yield(event)
                }
            }
            if let event = parser.finish() {
                if event.id != nil { lastEventId = event.id }
                delivered = true
                continuation.yield(event)
            }
            if delivered { attempt = 0 }

            if !options.reconnect || attempt >= options.maxReconnects { return }
            try await Task.sleep(nanoseconds: UInt64(Backoff.delay(attempt: attempt) * 1_000_000_000))
            attempt += 1
        }
        #endif
    }
}

/// Line-oriented `text/event-stream` decoder.
struct SSEParser {
    private var data: [String] = []
    private var event = ""
    private var id: String?
    private var retry: Int?
    private var hasFields = false

    /// Feed one line; returns an event when the frame is complete.
    mutating func feed(_ line: String) -> ServerEvent? {
        if line.isEmpty { return dispatch() }
        if line.hasPrefix(":") { return nil } // comment / keep-alive

        let field: String
        var value: String
        if let separator = line.firstIndex(of: ":") {
            field = String(line[line.startIndex..<separator])
            value = String(line[line.index(after: separator)...])
            if value.hasPrefix(" ") { value.removeFirst() }
        } else {
            field = line
            value = ""
        }

        hasFields = true
        switch field {
        case "event": event = value
        case "data": data.append(value)
        case "id": if !value.contains("\0") { id = value }
        case "retry": retry = Int(value)
        default: break // unknown fields are ignored
        }
        return nil
    }

    /// Flush a frame left unterminated when the connection closed.
    mutating func finish() -> ServerEvent? {
        dispatch()
    }

    private mutating func dispatch() -> ServerEvent? {
        guard hasFields else { return nil }
        let result = ServerEvent(
            id: id,
            event: event.isEmpty ? "message" : event,
            data: data.joined(separator: "\n"),
            retry: retry
        )
        data = []
        event = ""
        retry = nil
        hasFields = false
        return result
    }
}
