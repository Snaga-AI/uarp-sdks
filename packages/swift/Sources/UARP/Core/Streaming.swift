import Foundation

#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One decoded `text/event-stream` frame.
public struct ServerEvent: Sendable, Hashable {
    /// `id:` field (or the `event_id` inside an inline JSON frame), replayed as
    /// `Last-Event-ID` when the stream reconnects.
    public let id: String?
    /// `event:` field, the `type` inside a JSON payload, or `message`.
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

/// Connection-lifecycle states reported by ``EventStream`` via ``StreamOptions/onState``.
public enum StreamState: Sendable, Equatable {
    /// About to open (or reopen) the HTTP connection. Fired once, before the first attempt.
    case connecting
    /// The server answered 200 and the stream is being read.
    case connected
    /// Waiting on backoff before a reconnect attempt. `attempt` is 1-based.
    case reconnecting(Int)
    /// The stream ended without the caller cancelling it (terminal frame, `[DONE]`,
    /// or the reconnect budget exhausted).
    case disconnected
}

/// Reconnection and lifecycle behaviour for ``EventStream``. All new fields are
/// opt-in with standard-SSE defaults so a caller that passes nothing gets a
/// generic, spec-compliant stream — and the contract gate is unchanged.
public struct StreamOptions: Sendable {
    /// Reconnect (replaying `Last-Event-ID`) when the stream ends. Default `true`.
    public var reconnect: Bool
    /// Reconnect attempts without progress before giving up. Default `5`.
    public var maxReconnects: Int
    /// Event names that complete the stream WITHOUT reconnecting. Empty by default:
    /// a generic stream reconnects on end and lets the caller stop it. The
    /// platform's run stream passes `done`, `run.completed`, `run.failed`,
    /// `team_run_done`.
    public var terminalEvents: Set<String>
    /// Max silence between lines before the socket is presumed dead and a
    /// reconnect is attempted. `nil` disables the watchdog (a read timeout, or
    /// EOF, owns liveness instead). The platform sets this to 300 s: collapsing
    /// it with EOF made a silently-dead socket look like a finished stream and
    /// the chat went permanently quiet.
    public var inactivityTimeoutMillis: UInt64?
    /// Base reconnect interval in ms; a `retry:` field overrides it per stream.
    public var baseRetryMillis: UInt64
    /// Cap on the reconnect backoff.
    public var maxBackoffMillis: UInt64
    /// Reconnect budget resets after this long connected without a disconnect,
    /// so a long healthy stream doesn't carry "this is the Nth retry" baggage.
    public var stabilityResetMillis: UInt64
    /// Optional connection-lifecycle observer. The callback must be thread-safe;
    /// ``StreamState/disconnected`` is NOT fired when the caller cancels the
    /// stream — only on a natural end.
    public var onState: (@Sendable (StreamState) -> Void)?

    public init(
        reconnect: Bool = true,
        maxReconnects: Int = 5,
        terminalEvents: Set<String> = [],
        inactivityTimeoutMillis: UInt64? = nil,
        baseRetryMillis: UInt64 = 2000,
        maxBackoffMillis: UInt64 = 8000,
        stabilityResetMillis: UInt64 = 60_000,
        onState: (@Sendable (StreamState) -> Void)? = nil
    ) {
        self.reconnect = reconnect
        self.maxReconnects = maxReconnects
        self.terminalEvents = terminalEvents
        self.inactivityTimeoutMillis = inactivityTimeoutMillis
        self.baseRetryMillis = baseRetryMillis
        self.maxBackoffMillis = maxBackoffMillis
        self.stabilityResetMillis = stabilityResetMillis
        self.onState = onState
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
        var baseRetry = options.baseRetryMillis

        options.onState?(.connecting)

        RECONNECT: while !Task.isCancelled {
            if attempt > 0 {
                options.onState?(.reconnecting(attempt))
                let sleepNs = streamBackoff(attempt: attempt, base: baseRetry, max: options.maxBackoffMillis) * 1_000_000
                try await Task.sleep(nanoseconds: sleepNs)
                if Task.isCancelled { break RECONNECT }
            }

            var attemptSpec = spec
            // A stream is long-lived; the unary timeout would cut it short.
            attemptSpec.options.timeout = spec.options.timeout ?? 86_400
            // On reconnect, replace any spec-supplied `Last-Event-ID` (case-insensitively)
            // with the id the last delivered event carried, so the stream resumes from
            // there. On the first attempt `lastEventId` is nil and the caller-supplied
            // id stays untouched.
            if let lastEventId {
                attemptSpec.headers = attemptSpec.headers.filter { $0.key.lowercased() != "last-event-id" }
                attemptSpec.headers["Last-Event-ID"] = lastEventId
            }
            if client.configuration.sseTokenInQuery {
                attemptSpec.query.append(URLQueryItem(name: "token", value: client.configuration.apiKey))
            }

            let request = try client.buildRequest(attemptSpec, idempotencyKey: nil, accept: "text/event-stream")
            let bytes: URLSession.AsyncBytes
            let response: URLResponse
            do {
                (bytes, response) = try await client.session.bytes(for: request)
            } catch {
                // A connection that never opened retries like a dropped socket
                // while the reconnect budget lasts, then surfaces.
                if !options.reconnect || attempt >= options.maxReconnects {
                    throw UARPError.connection(underlying: error)
                }
                attempt += 1
                continue RECONNECT
            }

            guard let http = response as? HTTPURLResponse else {
                throw UARPError.connection(underlying: URLError(.badServerResponse))
            }

            if !(200..<300).contains(http.statusCode) {
                var body = Data()
                for try await byte in bytes { body.append(byte) }
                let apiError = APIError(
                    status: http.statusCode,
                    problem: UARPClient.problem(from: body),
                    headers: UARPClient.normalizedHeaders(http)
                )
                // 401 always surfaces so the caller can act on it (the app stops the
                // stream); any other HTTP error retries like a dropped connection
                // while the reconnect budget lasts, then surfaces.
                if http.statusCode == 401 || !options.reconnect || attempt >= options.maxReconnects {
                    throw UARPError.api(apiError)
                }
                attempt += 1
                continue RECONNECT
            }

            options.onState?(.connected)

            // A connection that delivered at least one event counts as progress
            // and resets the reconnect budget; one that closed immediately does
            // not, so a flapping server cannot spin this loop.
            var delivered = false
            var terminal = false
            var watchdogTripped = false
            let connectedAt = DispatchTime.now().uptimeNanoseconds
            var parser = SSEParser()

            // Inactivity watchdog. `URLSession.AsyncBytes` has no per-read timeout,
            // so each line read is raced against a watchdog `Task` that cancels the
            // underlying `URLSessionDataTask` (exposed as `bytes.task`) after
            // `inactivityTimeoutMillis` of silence. Cancelling the data task — NOT
            // the Swift `Task` — makes the byte iterator throw, which keeps the
            // stream's own task alive so it can loop and reconnect. A shared flag
            // distinguishes a watchdog trip (reconnect) from a user cancellation
            // (propagate). The task-group race was rejected because `withTaskGroup`
            // waits for all child tasks to settle even after `next()` returns, and a
            // byte-read child that doesn't promptly honour cancellation would hang
            // the whole stream; cancelling the data task interrupts the read
            // directly. `DispatchTime` (monotonic) is used for the stability clock
            // instead of `Date()` so wall-clock skew can't reset the budget wrongly.
            let dataTask = bytes.task
            let watchdogFlag = WatchdogFlag()
            var watchdog: Task<Void, Never>?
            defer { watchdog?.cancel() }

            func armWatchdog() {
                watchdog?.cancel()
                guard let timeout = options.inactivityTimeoutMillis else { return }
                let flag = watchdogFlag
                let task = dataTask
                watchdog = Task {
                    try? await Task.sleep(nanoseconds: timeout * 1_000_000)
                    if Task.isCancelled { return }
                    flag.set()
                    task.cancel()
                }
            }

            var buffer: [UInt8] = []
            var lineIteratorDone = false
            var iter = bytes.makeAsyncIterator()

            LINE: while !Task.isCancelled {
                buffer.removeAll(keepingCapacity: true)
                armWatchdog()
                do {
                    while !Task.isCancelled {
                        guard let byte = try await iter.next() else {
                            lineIteratorDone = true
                            break
                        }
                        if byte == 0x0A {
                            if buffer.last == 0x0D { buffer.removeLast() }
                            break
                        }
                        buffer.append(byte)
                    }
                } catch {
                    if watchdogFlag.consume() {
                        watchdogTripped = true
                    } else if Task.isCancelled {
                        throw CancellationError()
                    } else {
                        // Dropped mid-line: treat like a silent socket and reconnect.
                        watchdogTripped = true
                    }
                    break LINE
                }
                watchdog?.cancel()
                if lineIteratorDone { break LINE }
                if Task.isCancelled { break LINE }

                let line = String(decoding: buffer, as: UTF8.self)

                // A healthy connection that survived the stability window shouldn't
                // carry "this is the Nth retry" baggage into its next disconnect.
                if attempt > 0 {
                    let elapsed = DispatchTime.now().uptimeNanoseconds - connectedAt
                    if elapsed >= options.stabilityResetMillis * 1_000_000 { attempt = 0 }
                }

                let event = parser.feed(line)
                // `data: [DONE]` may return a flushed pending event OR nil, but
                // either way it sets `isDone` — so check it before the `guard`
                // below would skip the terminal test on a nil return.
                if parser.isDone {
                    if let flushed = event {
                        if let id = flushed.id { lastEventId = id }
                        if let r = flushed.retry, r > 0 { baseRetry = UInt64(r) }
                        delivered = true
                        continuation.yield(flushed)
                    }
                    terminal = true
                    break LINE
                }
                guard let dispatched = event else { continue LINE }
                if let id = dispatched.id { lastEventId = id }
                if let r = dispatched.retry, r > 0 { baseRetry = UInt64(r) }
                delivered = true
                continuation.yield(dispatched)
                if options.terminalEvents.contains(dispatched.event) {
                    terminal = true
                    break LINE
                }
            }

            // Flush a partial line / pending frame on a clean end. A watchdog trip
            // drops the partial frame (matching Kotlin's `continue@reconnect`); a
            // terminal frame was already yielded inside the loop.
            if !watchdogTripped && !Task.isCancelled && !terminal {
                if !buffer.isEmpty {
                    if buffer.last == 0x0D { buffer.removeLast() }
                    if let event = parser.feed(String(decoding: buffer, as: UTF8.self)) {
                        if let id = event.id { lastEventId = id }
                        if let r = event.retry, r > 0 { baseRetry = UInt64(r) }
                        delivered = true
                        if options.terminalEvents.contains(event.event) { terminal = true }
                        continuation.yield(event)
                    }
                }
                if let event = parser.finish() {
                    if let id = event.id { lastEventId = id }
                    if let r = event.retry, r > 0 { baseRetry = UInt64(r) }
                    delivered = true
                    if options.terminalEvents.contains(event.event) || parser.isDone { terminal = true }
                    continuation.yield(event)
                }
            }

            if Task.isCancelled { break RECONNECT }
            if terminal { break RECONNECT }
            if watchdogTripped {
                // Inactivity: reconnect without the delivered-reset, matching
                // Kotlin's `attempt++; continue@reconnect` inside the read loop.
                if !options.reconnect || attempt >= options.maxReconnects { break RECONNECT }
                attempt += 1
                continue RECONNECT
            }
            // A clean EOF without a terminal frame is a proxy/socket drop mid-run,
            // not a finished stream — reconnect with `Last-Event-ID`.
            if delivered { attempt = 0 }
            if !options.reconnect || attempt >= options.maxReconnects { break RECONNECT }
            attempt += 1
        }

        // Only a natural end reports `.disconnected` — a caller that cancelled
        // the stream has already decided it is done.
        if !Task.isCancelled { options.onState?(.disconnected) }
        #endif
    }
}

/// Half-deterministic, half-random backoff: `maxSleep/2 + rand(0..maxSleep/2)`,
/// so it climbs with attempts but clients don't all wake on the same boundary.
/// Used for stream reconnects only; unary retries keep ``Backoff/delay(attempt:)``.
private func streamBackoff(attempt: Int, base: UInt64, max maxDelay: UInt64) -> UInt64 {
    let exponential = Double(base) * pow(2.0, Double(max(0, attempt - 1)))
    let maxSleep = min(Double(maxDelay), exponential)
    let half = max(1.0, maxSleep / 2)
    var rng = SystemRandomNumberGenerator()
    let jitter = Double.random(in: 0..<half, using: &rng)
    return UInt64(max(0, half + jitter))
}

/// A thread-safe flag set by the watchdog before it cancels the data task, so the
/// read loop can tell a watchdog trip (reconnect) from a user cancellation.
private final class WatchdogFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var fired = false

    func set() {
        lock.lock(); defer { lock.unlock() }
        fired = true
    }

    /// Read and clear atomically.
    func consume() -> Bool {
        lock.lock(); defer { lock.unlock() }
        let wasFired = fired
        fired = false
        return wasFired
    }
}

/// Line-oriented `text/event-stream` decoder. Handles the three wire shapes the
/// platform emits and the `[DONE]` hard terminal; a frame with no `data:` is not
/// a deliverable event (an `id:`-only frame only updates the last event id).
struct SSEParser {
    private var data: [String] = []
    private var event = ""
    private var id: String?
    private var retry: Int?
    private var hasFields = false
    private var done = false

    /// `true` once a `data: [DONE]` frame arrived — the stream terminates without
    /// reconnecting.
    var isDone: Bool { done }

    /// Feed one line; returns an event when the frame is complete.
    mutating func feed(_ line: String) -> ServerEvent? {
        if line.isEmpty { return dispatch() }

        // SSE comment. The platform also carries a JSON object in a comment
        // (`:{"type":"…","event_id":"…"}`); that is a self-contained frame.
        // A bare comment is a keep-alive.
        if line.hasPrefix(":") {
            let body = line.dropFirst().trimmingCharacters(in: .whitespaces)
            if body.hasPrefix("{") { return inlineEvent(String(body)) }
            return nil
        }

        // Bare NDJSON line — a self-contained frame with no field prefix.
        if line.hasPrefix("{") { return inlineEvent(line) }

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
        case "data":
            if value == "[DONE]" {
                done = true
                // Flush a pending event, if any; `[DONE]` itself carries no payload.
                if !data.isEmpty || !event.isEmpty || id != nil { return dispatch() }
                return nil
            }
            data.append(value)
        case "id": if !value.contains("\0") { id = value }
        case "retry": retry = Int(value)
        default: break // unknown fields are ignored
        }
        return nil
    }

    /// Flush a frame left unterminated when the connection closed.
    mutating func finish() -> ServerEvent? { dispatch() }

    private mutating func dispatch() -> ServerEvent? {
        guard hasFields else { return nil }
        let joined = data.joined(separator: "\n")
        // A frame with no data is not a deliverable event: an `id:`/`retry:`-only
        // frame updates state but carries nothing to emit.
        if joined.isEmpty {
            reset()
            return nil
        }
        let resolved = event.isEmpty ? (extractEventType(joined) ?? "message") : event
        let result = ServerEvent(id: id, event: resolved, data: joined, retry: retry)
        reset()
        return result
    }

    /// A comment-JSON or NDJSON frame: type and id live inside the JSON body.
    /// Self-contained — does not mutate parser state.
    private func inlineEvent(_ body: String) -> ServerEvent {
        ServerEvent(
            id: extractField(body, "event_id"),
            event: extractEventType(body) ?? "message",
            data: body
        )
    }

    private mutating func reset() {
        data = []
        event = ""
        id = nil
        retry = nil
        hasFields = false
        // `id` is per-frame: the platform's client resets it on dispatch, so an
        // event's id is only the `id:` its own frame carried (or the `event_id`
        // inside a JSON payload). The loop captures the emitted id for replay
        // before this runs, so reconnect still resumes from the last event id.
    }
}

/// Pull one string field out of a JSON body WITHOUT fully decoding it — the
/// stream carries thousands of frames a minute, and a full parse per frame to
/// learn its `type` is the difference between a smooth stream and a stuttering
/// one. Honours escaped quotes so a `"` inside a value can't fool it. The scan
/// is ASCII-driven over the UTF-8 view; the sliced value preserves multi-byte
/// sequences because `String.UTF8View` shares `String` indices.
fileprivate func extractField(_ json: String, _ field: String) -> String? {
    let needle = "\"\(field)\""
    guard let range = json.range(of: needle) else { return nil }
    var i = range.upperBound
    let bytes = json.utf8
    while i < bytes.endIndex, bytes[i] == UInt8(ascii: ":") || bytes[i] == UInt8(ascii: " ") {
        i = bytes.index(after: i)
    }
    guard i < bytes.endIndex, bytes[i] == UInt8(ascii: "\"") else { return nil }
    i = bytes.index(after: i)
    let valueStart = i
    while i < bytes.endIndex {
        let c = bytes[i]
        if c == UInt8(ascii: "\\") {
            i = bytes.index(after: i)
            if i < bytes.endIndex { i = bytes.index(after: i) }
            continue
        }
        if c == UInt8(ascii: "\"") { break }
        i = bytes.index(after: i)
    }
    if i <= valueStart { return nil }
    return String(json[valueStart..<i])
}

/// The `type` field of a JSON frame, peeked without decoding.
fileprivate func extractEventType(_ json: String) -> String? {
    extractField(json, "type")
}