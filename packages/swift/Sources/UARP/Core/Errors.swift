import Foundation

/// RFC 9457 problem document returned by the API on failure.
public struct Problem: Codable, Hashable, Sendable {
    public var type: String?
    public var title: String?
    public var status: Int?
    public var detail: String?
    /// Request identifier to quote when reporting an incident.
    public var correlationId: String?
    /// Field-level validation failures, present on 422 responses.
    public var errors: [FieldError]?

    public init(
        type: String? = nil,
        title: String? = nil,
        status: Int? = nil,
        detail: String? = nil,
        correlationId: String? = nil,
        errors: [FieldError]? = nil
    ) {
        self.type = type
        self.title = title
        self.status = status
        self.detail = detail
        self.correlationId = correlationId
        self.errors = errors
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

    public init(status: Int, problem: Problem, headers: [String: String]) {
        self.status = status
        self.problem = problem
        self.headers = headers
    }

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

    /// Request identifier for support tickets.
    public var correlationId: String? {
        problem.correlationId ?? headers["x-correlation-id"]
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
