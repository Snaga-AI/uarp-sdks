import Foundation

/// RFC 9457 problem document returned by the API on failure.
public struct Problem: Codable, Hashable, Sendable {
    public var type: String?
    public var title: String?
    public var status: Int?
    public var detail: String?
    /// What a client should do about the failure, as a stable value to switch
    /// on (`SESSION_NOT_ACTIVE`, `QUOTA_EXCEEDED`, `resource_limit_reached`, …).
    /// `detail` is the sentence for a person and can change; this cannot. The
    /// values are those of `ErrorCode`, kept as a string here so that a code
    /// added after this SDK was built still reaches the caller.
    public var code: String?
    /// Request identifier to quote when reporting an incident. Read from
    /// `correlation_id`, or from the deprecated `correlationId` spelling.
    public var correlationId: String?
    /// Field-level validation failures, present on 422 responses.
    public var errors: [FieldError]?
    /// Every other member of the document, as sent: `session_status`, `reason`,
    /// `retry_after` and whatever a route adds. A problem document is open by
    /// definition, and decoding only the six members above lost the rest.
    public var extensions: [String: JSONValue]

    public init(
        type: String? = nil,
        title: String? = nil,
        status: Int? = nil,
        detail: String? = nil,
        correlationId: String? = nil,
        errors: [FieldError]? = nil,
        code: String? = nil,
        extensions: [String: JSONValue] = [:]
    ) {
        self.type = type
        self.title = title
        self.status = status
        self.detail = detail
        self.correlationId = correlationId
        self.errors = errors
        self.code = code
        self.extensions = extensions
    }

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(_ string: String) { stringValue = string }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    private static let members: Set<String> = [
        "type", "title", "status", "detail", "code", "correlation_id", "correlationId", "errors",
    ]

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Key.self)
        type = try container.decodeIfPresent(String.self, forKey: Key("type"))
        title = try container.decodeIfPresent(String.self, forKey: Key("title"))
        status = try container.decodeIfPresent(Int.self, forKey: Key("status"))
        detail = try container.decodeIfPresent(String.self, forKey: Key("detail"))
        code = try container.decodeIfPresent(String.self, forKey: Key("code"))
        correlationId = try container.decodeIfPresent(String.self, forKey: Key("correlation_id"))
            ?? container.decodeIfPresent(String.self, forKey: Key("correlationId"))
        errors = try container.decodeIfPresent([FieldError].self, forKey: Key("errors"))
        var rest: [String: JSONValue] = [:]
        for key in container.allKeys where !Self.members.contains(key.stringValue) {
            rest[key.stringValue] = try container.decode(JSONValue.self, forKey: key)
        }
        extensions = rest
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        for (key, value) in extensions { try container.encode(value, forKey: Key(key)) }
        try container.encodeIfPresent(type, forKey: Key("type"))
        try container.encodeIfPresent(title, forKey: Key("title"))
        try container.encodeIfPresent(status, forKey: Key("status"))
        try container.encodeIfPresent(detail, forKey: Key("detail"))
        try container.encodeIfPresent(code, forKey: Key("code"))
        try container.encodeIfPresent(correlationId, forKey: Key("correlation_id"))
        try container.encodeIfPresent(errors, forKey: Key("errors"))
    }
}

public struct FieldError: Codable, Hashable, Sendable {
    public var field: String?
    public var message: String?
}

/// A coarse classification of an ``APIError``.
public enum APIErrorKind: Sendable, Hashable {
    case badRequest
    case authentication
    case permissionDenied
    case notFound
    case conflict
    case gone
    case payloadTooLarge
    case unprocessableEntity
    case rateLimit
    case serviceUnavailable
    case server
    case other
}

/// A non-2xx response, with the parsed problem document attached.
public struct APIError: Error, Sendable, CustomStringConvertible {
    public let status: Int
    public let problem: Problem
    /// Response headers, keyed by lower-cased name.
    public let headers: [String: String]
    /// The response body exactly as received, for whatever the problem
    /// document does not model.
    public let body: Data?

    public init(status: Int, problem: Problem, headers: [String: String], body: Data? = nil) {
        self.status = status
        self.problem = problem
        self.headers = headers
        self.body = body
    }

    /// The stable code to switch on, e.g. `SESSION_NOT_ACTIVE`.
    public var code: String? { problem.code }

    /// Why, when the code alone does not say: a refused `X-Active-Tenant`
    /// answers 403 `FORBIDDEN` with `not_a_member` or `membership_suspended`.
    /// The problem's `reason` member, when it is a string.
    public var reason: String? { problem.extensions["reason"]?.stringValue }

    public var kind: APIErrorKind {
        switch status {
        case 400: return .badRequest
        case 401: return .authentication
        case 403: return .permissionDenied
        case 404: return .notFound
        case 409: return .conflict
        case 410: return .gone
        case 413: return .payloadTooLarge
        case 422: return .unprocessableEntity
        case 429: return .rateLimit
        case 503: return .serviceUnavailable
        case 500...599: return .server
        default: return .other
        }
    }

    /// Request identifier for support tickets. The server sends it as
    /// `X-Request-Id`; `X-Correlation-Id` is read for older deployments.
    public var correlationId: String? {
        problem.correlationId ?? headers["x-request-id"] ?? headers["x-correlation-id"]
    }

    /// Seconds the server asked the client to wait, from `Retry-After`.
    public var retryAfterSeconds: Double? {
        headers["retry-after"].flatMap(Double.init)
    }

    public var rateLimitRemaining: Int? {
        headers["x-ratelimit-remaining"].flatMap(Int.init)
    }

    /// Field-level validation failures, present on 422 responses.
    public var validationErrors: [FieldError] {
        problem.errors ?? []
    }

    public var isRetryable: Bool {
        [408, 409, 429, 500, 502, 503, 504].contains(status)
    }

    public var description: String {
        var text = "\(status) \(problem.title ?? "HTTP error")"
        if let detail = problem.detail { text += " — \(detail)" }
        if let correlationId { text += " (correlationId: \(correlationId))" }
        return text
    }
}

/// Everything the SDK throws.
public enum UARPError: Error, CustomStringConvertible {
    /// The server answered with a non-2xx status.
    case api(APIError)
    /// The request never reached the server, or the connection dropped.
    case connection(underlying: Error)
    /// The request exceeded its timeout.
    case timeout
    /// The response body did not match the expected shape.
    case decoding(underlying: Error, body: Data)
    /// The request body could not be encoded.
    case encoding(underlying: Error)
    /// The client was configured with something unusable.
    case configuration(String)
    /// The event stream failed mid-flight.
    case stream(String)

    /// The HTTP status, when the failure came from the server.
    public var status: Int? {
        if case .api(let error) = self { return error.status }
        return nil
    }

    public var isRetryable: Bool {
        switch self {
        case .api(let error): return error.isRetryable
        case .connection, .timeout: return true
        default: return false
        }
    }

    public var description: String {
        switch self {
        case .api(let error): return error.description
        case .connection(let underlying): return "connection error: \(underlying)"
        case .timeout: return "request timed out"
        case .decoding(let underlying, _): return "failed to decode response body: \(underlying)"
        case .encoding(let underlying): return "failed to encode request body: \(underlying)"
        case .configuration(let message): return "invalid client configuration: \(message)"
        case .stream(let message): return "event stream error: \(message)"
        }
    }
}

extension UARPError: LocalizedError {
    public var errorDescription: String? { description }
}
