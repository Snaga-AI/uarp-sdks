import Foundation

#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Configuration for ``UARPClient``.
public struct Configuration: Sendable {
    /// API key in `uarp_<prefix>_<secret>` form.
    public var apiKey: String
    /// Base URL every request is resolved against.
    public var baseURL: URL
    /// Per-request timeout. Default 60 s.
    public var timeout: TimeInterval
    /// Retries for transient failures. Default 2.
    public var maxRetries: Int
    /// Headers merged into every request.
    public var defaultHeaders: [String: String]
    /// Appended to the SDK's own User-Agent.
    public var userAgentSuffix: String?
    /// Send the API key as `?token=` on SSE requests instead of a header.
    public var sseTokenInQuery: Bool

    public init(
        apiKey: String,
        baseURL: URL = URL(string: defaultBaseURL)!,
        timeout: TimeInterval = 60,
        maxRetries: Int = 2,
        defaultHeaders: [String: String] = [:],
        userAgentSuffix: String? = nil,
        sseTokenInQuery: Bool = false
    ) {
        self.apiKey = apiKey
        self.baseURL = baseURL
        self.timeout = timeout
        self.maxRetries = maxRetries
        self.defaultHeaders = defaultHeaders
        self.userAgentSuffix = userAgentSuffix
        self.sseTokenInQuery = sseTokenInQuery
    }

    /// Read `UARP_API_KEY` (or `SNAGA_API_KEY`) and `UARP_BASE_URL` from the environment.
    public static func fromEnvironment() throws -> Configuration {
        let environment = ProcessInfo.processInfo.environment
        guard let apiKey = environment["UARP_API_KEY"] ?? environment["SNAGA_API_KEY"] else {
            throw UARPError.configuration("UARP_API_KEY is not set")
        }
        var configuration = Configuration(apiKey: apiKey)
        if let base = environment["UARP_BASE_URL"], let url = URL(string: base) {
            configuration.baseURL = url
        }
        return configuration
    }
}

/// Per-call overrides.
public struct RequestOptions: Sendable {
    public var timeout: TimeInterval?
    public var maxRetries: Int?
    /// Extra headers for this call.
    public var headers: [String: String]
    /// Reuse a specific idempotency key, e.g. to safely replay a create.
    public var idempotencyKey: String?
    /// Extra query parameters merged into the generated ones.
    public var query: [URLQueryItem]
    public var baseURL: URL?
    /// SSE-only knobs; ignored by unary requests.
    public var stream: StreamOptions

    public init(
        timeout: TimeInterval? = nil,
        maxRetries: Int? = nil,
        headers: [String: String] = [:],
        idempotencyKey: String? = nil,
        query: [URLQueryItem] = [],
        baseURL: URL? = nil,
        stream: StreamOptions = .init()
    ) {
        self.timeout = timeout
        self.maxRetries = maxRetries
        self.headers = headers
        self.idempotencyKey = idempotencyKey
        self.query = query
        self.baseURL = baseURL
        self.stream = stream
    }
}

/// The wire description a generated method hands to the transport.
public struct RequestSpec: Sendable {
    public var method: String
    public var path: String
    public var query: [URLQueryItem]
    public var headers: [String: String]
    public var body: RequestBody?
    /// Adds an `Idempotency-Key`, which also makes the write safe to retry.
    public var idempotent: Bool
    public var options: RequestOptions

    public init(
        method: String,
        path: String,
        query: [URLQueryItem] = [],
        headers: [String: String] = [:],
        body: RequestBody? = nil,
        idempotent: Bool = false,
        options: RequestOptions = .init()
    ) {
        self.method = method
        self.path = path
        self.query = query
        self.headers = headers
        self.body = body
        self.idempotent = idempotent
        self.options = options
    }
}

public enum RequestBody: Sendable {
    case json(Data)
    case raw(Data, contentType: String)
    case multipart([MultipartPart])
}

public struct MultipartPart: Sendable {
    public var name: String
    public var value: MultipartValue

    public init(name: String, value: MultipartValue) {
        self.name = name
        self.value = value
    }
}

public enum MultipartValue: Sendable {
    case text(String)
    case file(FilePart)
}

/// Client for the UARP platform API.
///
/// ```swift
/// let client = try UARPClient(apiKey: ProcessInfo.processInfo.environment["UARP_API_KEY"]!)
/// let page = try await client.agents.list(limit: 20)
/// ```
public final class UARPClient: @unchecked Sendable {
    public let configuration: Configuration
    let session: URLSession
    let encoder: JSONEncoder
    let decoder: JSONDecoder

    private static let retryableStatuses: Set<Int> = [408, 409, 429, 500, 502, 503, 504]

    public init(configuration: Configuration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    public convenience init(apiKey: String, baseURL: URL = URL(string: defaultBaseURL)!, session: URLSession = .shared) {
        self.init(configuration: Configuration(apiKey: apiKey, baseURL: baseURL), session: session)
    }

    /// Build a client from `UARP_API_KEY` / `UARP_BASE_URL`.
    public static func fromEnvironment(session: URLSession = .shared) throws -> UARPClient {
        UARPClient(configuration: try Configuration.fromEnvironment(), session: session)
    }

    public var baseURL: URL { configuration.baseURL }

    var userAgent: String {
        let base = "uarp-sdk-swift/\(sdkVersion)"
        guard let suffix = configuration.userAgentSuffix else { return base }
        return "\(base) \(suffix)"
    }

    // MARK: - Encoding helpers used by generated code

    public func encode<T: Encodable>(_ value: T) throws -> RequestBody {
        do {
            return .json(try encoder.encode(value))
        } catch {
            throw UARPError.encoding(underlying: error)
        }
    }

    // MARK: - Transport

    /// Send a request and decode a JSON response body.
    public func send<Response: Decodable>(_ spec: RequestSpec) async throws -> Response {
        let (data, _) = try await perform(spec)
        if data.isEmpty, let empty = JSONValue.null as? Response { return empty }
        do {
            return try decoder.decode(Response.self, from: data.isEmpty ? Data("null".utf8) : data)
        } catch {
            throw UARPError.decoding(underlying: error, body: data)
        }
    }

    /// Send a request and discard the response body.
    public func sendVoid(_ spec: RequestSpec) async throws {
        _ = try await perform(spec)
    }

    /// Send a request and return the raw response bytes (file downloads).
    public func sendData(_ spec: RequestSpec) async throws -> Data {
        let (data, _) = try await perform(spec)
        return data
    }

    /// Open a server-sent event stream.
    public func sendStream(_ spec: RequestSpec) -> EventStream {
        EventStream(client: self, spec: spec, options: spec.options.stream)
    }

    /// Send a request and return the raw response bytes and HTTP status, WITHOUT
    /// throwing on a non-2xx body.
    ///
    /// Transient failures (the retryable status codes, timeouts, dropped
    /// connections) still retry up to `maxRetries` exactly as ``send`` does; the
    /// terminal response — success OR failure — is returned so the caller can
    /// decode it through its own decoder. This is the transport-only primitive a
    /// consumer builds its tolerant decoding on: the SDK owns retry,
    /// idempotency and request-building; the caller owns the response shape and
    /// turns a non-2xx into whatever error type it already uses.
    ///
    /// ``send``/``sendData``/``sendVoid`` thin over this and throw
    /// ``UARPError``.api`` on a non-2xx; use ``sendRaw`` when you need the body of
    /// an error response (an API that answers a refusal with a bare
    /// `{"error":"…"}` rather than an RFC 9457 document, or a problem+json the
    /// caller decodes with its own keys).
    ///
    /// Throws ``UARPError``.connection`` / ``.timeout`` only when no HTTP
    /// response was ever received — the request never reached the server, or
    /// it timed out. Any HTTP status, 2xx through 5xx, is returned, not thrown.
    public func sendRaw(_ spec: RequestSpec) async throws -> (Data, HTTPURLResponse) {
        try await performRaw(spec)
    }

    // MARK: - Internals

    private func performRaw(_ spec: RequestSpec) async throws -> (Data, HTTPURLResponse) {
        let maxRetries = spec.options.maxRetries ?? configuration.maxRetries
        let idempotencyKey = spec.idempotent ? (spec.options.idempotencyKey ?? UUID().uuidString) : nil
        let canRetry = spec.method == "GET" || spec.method == "HEAD" || idempotencyKey != nil
        var attempt = 0

        while true {
            let request = try buildRequest(spec, idempotencyKey: idempotencyKey)
            do {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw UARPError.connection(underlying: URLError(.badServerResponse))
                }
                if (200..<300).contains(http.statusCode) {
                    return (data, http)
                }

                let headers = Self.normalizedHeaders(http)
                let shouldRetry = Self.retryableStatuses.contains(http.statusCode)
                    && headers["x-should-retry"] != "false"
                    && canRetry
                    && attempt < maxRetries
                // A non-retryable failure is still an HTTP response the caller
                // wants to decode — return it rather than throwing away the body.
                if !shouldRetry { return (data, http) }

                let wait = headers["retry-after"].flatMap(Double.init) ?? Backoff.delay(attempt: attempt)
                attempt += 1
                try await Task.sleep(nanoseconds: UInt64(min(wait, 60) * 1_000_000_000))
            } catch let error as UARPError {
                throw error
            } catch let error as URLError where error.code == .timedOut {
                if !canRetry || attempt >= maxRetries { throw UARPError.timeout }
                attempt += 1
                try await Task.sleep(nanoseconds: UInt64(Backoff.delay(attempt: attempt) * 1_000_000_000))
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                if !canRetry || attempt >= maxRetries { throw UARPError.connection(underlying: error) }
                attempt += 1
                try await Task.sleep(nanoseconds: UInt64(Backoff.delay(attempt: attempt) * 1_000_000_000))
            }
        }
    }

    private func perform(_ spec: RequestSpec) async throws -> (Data, HTTPURLResponse) {
        let (data, http) = try await performRaw(spec)
        if (200..<300).contains(http.statusCode) { return (data, http) }
        let headers = Self.normalizedHeaders(http)
        throw UARPError.api(APIError(status: http.statusCode, problem: Self.problem(from: data), headers: headers))
    }

    func buildRequest(_ spec: RequestSpec, idempotencyKey: String?, accept: String = "application/json") throws -> URLRequest {
        let base = spec.options.baseURL ?? configuration.baseURL
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            throw UARPError.configuration("invalid base URL: \(base)")
        }
        // The path segments are already percent-encoded by the generated code;
        // assigning to `path` would escape those `%` signs a second time.
        components.percentEncodedPath = Self.joinPaths(components.percentEncodedPath, spec.path)
        let items = spec.query + spec.options.query
        //  Encoded by hand: URLQueryItem leaves `+` alone, and a server that
        //  applies form-decoding rules would read that back as a space.
        components.percentEncodedQuery = items.isEmpty ? nil : encodeQuery(items)
        guard let url = components.url else {
            throw UARPError.configuration("could not build URL for \(spec.path)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = spec.method
        request.timeoutInterval = spec.options.timeout ?? configuration.timeout
        request.setValue(accept, forHTTPHeaderField: "Accept")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        // An empty key means "no credentials" (a guest/public client). Sending
        // `Bearer ` with nothing after it is not the same as sending no header,
        // and a server that validates the Authorization value can refuse it, so
        // skip the header entirely when the key is empty.
        if !configuration.apiKey.isEmpty {
            request.setValue("Bearer \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
        }
        for (name, value) in configuration.defaultHeaders {
            request.setValue(value, forHTTPHeaderField: name)
        }
        for (name, value) in spec.headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }

        switch spec.body {
        case .json(let data):
            request.httpBody = data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        case .raw(let data, let contentType):
            request.httpBody = data
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        case .multipart(let parts):
            let boundary = "uarp-\(UUID().uuidString)"
            request.httpBody = Self.encodeMultipart(parts, boundary: boundary)
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        case nil:
            break
        }

        for (name, value) in spec.options.headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        return request
    }

    static func joinPaths(_ base: String, _ path: String) -> String {
        // Some callers historically passed query inline (e.g. "runs?limit=50")
        // because the public API surface has no separate `query` parameter on
        // every convenience path. The query belongs in `spec.query` (or
        // `spec.options.query`), NOT in `percentEncodedPath` — assigning
        // `/v1/runs?limit=50` to `percentEncodedPath` trips Foundation's
        // URLComponents precondition and crashes the app at boot. Strip the
        // query portion here so a malformed input degrades to "sends a request
        // without the query" rather than a SIGILL.
        let pathOnly: String
        if let queryStart = path.firstIndex(of: "?") {
            pathOnly = String(path[..<queryStart])
        } else {
            pathOnly = path
        }
        let trimmedBase = base.hasSuffix("/") ? String(base.dropLast()) : base
        let normalized = pathOnly.hasPrefix("/") ? pathOnly : "/" + pathOnly
        return trimmedBase + normalized
    }

    static func normalizedHeaders(_ response: HTTPURLResponse) -> [String: String] {
        var headers: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            guard let name = key as? String, let text = value as? String else { continue }
            headers[name.lowercased()] = text
        }
        return headers
    }

    /// RFC 9457 keys. A body carrying none of them is not a problem document,
    /// however well-formed its JSON is.
    private static let problemKeys: Set<String> = [
        "type", "title", "status", "detail", "correlationId", "errors",
    ]

    /// Extract the failure message, whatever shape the server used to send it.
    ///
    /// Every field of `Problem` is optional, so `{"error": "Insufficient role"}`
    /// DECODED SUCCESSFULLY into an all-nil `Problem` and the raw-text fallback
    /// below never ran — it was dead code for exactly the input it was written
    /// for. The API answers 32 places with that bare shape, and each one reached
    /// callers as a failure with no message at all.
    ///
    /// Diagnosed by the iOS session, which had been carrying its own
    /// `ProblemError` with an `error` key since 2026-08-13 to work around it.
    static func problem(from data: Data) -> Problem {
        guard !data.isEmpty else { return Problem() }
        let raw = String(data: data, encoding: .utf8)
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if !problemKeys.isDisjoint(with: object.keys),
               let problem = try? JSONDecoder().decode(Problem.self, from: data) {
                return problem
            }
            return Problem(detail: message(from: object) ?? raw)
        }
        return Problem(detail: raw)
    }

    /// `{"error": "..."}`, `{"error": {"message": "..."}}` and `{"message": "..."}`.
    private static func message(from object: [String: Any]) -> String? {
        if let error = object["error"] as? String { return error }
        if let nested = object["error"] as? [String: Any], let text = nested["message"] as? String {
            return text
        }
        return object["message"] as? String
    }

    static func encodeMultipart(_ parts: [MultipartPart], boundary: String) -> Data {
        var body = Data()
        for part in parts {
            body.append(Data("--\(boundary)\r\n".utf8))
            switch part.value {
            case .text(let text):
                body.append(Data("Content-Disposition: form-data; name=\"\(part.name)\"\r\n\r\n".utf8))
                body.append(Data(text.utf8))
            case .file(let file):
                let disposition = "Content-Disposition: form-data; name=\"\(part.name)\"; filename=\"\(file.filename)\"\r\n"
                body.append(Data(disposition.utf8))
                let contentType = file.contentType ?? "application/octet-stream"
                body.append(Data("Content-Type: \(contentType)\r\n\r\n".utf8))
                body.append(file.data)
            }
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))
        return body
    }
}

/// Full-jitter exponential backoff capped at 8 s.
enum Backoff {
    static func delay(attempt: Int) -> Double {
        let capped = min(8.0, 0.5 * pow(2.0, Double(attempt)))
        return capped * Double.random(in: 0.5...1.0)
    }
}

/// The RFC 3986 unreserved set: everything else is percent-encoded.
///
/// Deliberately strict. Leaving a sub-delimiter such as `+` or `&` unescaped is
/// legal in a URL but changes what a form-decoding server reads back, and the
/// five SDKs have to agree byte for byte.
private let unreserved: CharacterSet = {
    var allowed = CharacterSet(charactersIn: "A"..."Z")
    allowed.formUnion(CharacterSet(charactersIn: "a"..."z"))
    allowed.formUnion(CharacterSet(charactersIn: "0"..."9"))
    allowed.insert(charactersIn: "-._~")
    return allowed
}()

/// Percent-encode a value for use as a single URL path segment.
public func encodePathSegment(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? value
}

/// Percent-encode one query name or value.
public func encodeQueryComponent(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? value
}

/// Render `?a=1&b=2`, with every component strictly encoded.
func encodeQuery(_ items: [URLQueryItem]) -> String {
    items
        .map { "\(encodeQueryComponent($0.name))=\(encodeQueryComponent($0.value ?? ""))" }
        .joined(separator: "&")
}
