package ai.snaga.uarp

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/** RFC 9457 problem document returned by the API on failure. */
@Serializable
public data class Problem(
    val type: String? = null,
    val title: String? = null,
    val status: Int? = null,
    val detail: String? = null,
    /** Request identifier to quote when reporting an incident. */
    @SerialName("correlation_id") val correlationId: String? = null,
    /** Field-level validation failures, present on 422 responses. */
    val errors: List<FieldError> = emptyList(),
    /**
     * What a client should do about the failure, as a stable value to switch on
     * (`SESSION_NOT_ACTIVE`, `QUOTA_EXCEEDED`, `resource_limit_reached`, …).
     * `detail` is the sentence for a person and can change; this cannot. A
     * string rather than `ErrorCode`, so that a code added after this SDK was
     * built still reaches the caller.
     */
    val code: String? = null,
    /**
     * The deprecated `correlationId` spelling of the request id, sent during a
     * compatibility window. [ApiException.correlationId] reads both.
     */
    @SerialName("correlationId") val legacyCorrelationId: String? = null,
    /** Every other member of the document (`session_status`, `reason`, `retry_after`, …), as sent. */
    @Transient val extensions: Map<String, JsonElement> = emptyMap(),
)

@Serializable
public data class FieldError(
    val field: String? = null,
    val message: String? = null,
)

/** A coarse classification of an [ApiException]. */
public enum class ApiErrorKind {
    BAD_REQUEST,
    AUTHENTICATION,
    PERMISSION_DENIED,
    NOT_FOUND,
    CONFLICT,
    GONE,
    PAYLOAD_TOO_LARGE,
    UNPROCESSABLE_ENTITY,
    RATE_LIMIT,
    SERVICE_UNAVAILABLE,
    SERVER,
    OTHER,
}

/** Base class for everything this SDK throws. */
public sealed class UarpException(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {
    /** Whether retrying the very same request could plausibly succeed. */
    public open val isRetryable: Boolean get() = false
}

/** The server answered with a non-2xx status. */
public class ApiException(
    /** HTTP status code. */
    public val status: Int,
    /** Parsed problem document; mostly empty when the server sent no body. */
    public val problem: Problem,
    /** Response headers, keyed by lower-cased name. */
    public val headers: Map<String, String>,
    /** Raw response body, kept for diagnostics. */
    public val body: String? = null,
) : UarpException(formatMessage(status, problem)) {

    public val kind: ApiErrorKind
        get() = when {
            status == 400 -> ApiErrorKind.BAD_REQUEST
            status == 401 -> ApiErrorKind.AUTHENTICATION
            status == 403 -> ApiErrorKind.PERMISSION_DENIED
            status == 404 -> ApiErrorKind.NOT_FOUND
            status == 409 -> ApiErrorKind.CONFLICT
            status == 410 -> ApiErrorKind.GONE
            status == 413 -> ApiErrorKind.PAYLOAD_TOO_LARGE
            status == 422 -> ApiErrorKind.UNPROCESSABLE_ENTITY
            status == 429 -> ApiErrorKind.RATE_LIMIT
            status == 503 -> ApiErrorKind.SERVICE_UNAVAILABLE
            status >= 500 -> ApiErrorKind.SERVER
            else -> ApiErrorKind.OTHER
        }

    /** The stable code to switch on, e.g. `SESSION_NOT_ACTIVE`. */
    public val code: String?
        get() = problem.code

    /**
     * Why, when the code alone does not say: a refused `X-Active-Tenant`
     * answers 403 `FORBIDDEN` with `not_a_member` or `membership_suspended`.
     * The problem's `reason` member, when it is a string.
     */
    public val reason: String?
        get() = (problem.extensions["reason"] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /**
     * Request identifier for support tickets: `correlation_id`, its deprecated
     * spelling, or the `X-Request-Id` header the server sends.
     */
    public val correlationId: String?
        get() = problem.correlationId ?: problem.legacyCorrelationId
            ?: headers["x-request-id"] ?: headers["x-correlation-id"]

    /** Seconds the server asked the client to wait, from `Retry-After`. */
    public val retryAfterSeconds: Double?
        get() = headers["retry-after"]?.toDoubleOrNull()

    public val rateLimitRemaining: Int?
        get() = headers["x-ratelimit-remaining"]?.toIntOrNull()

    /** Field-level validation failures, present on 422 responses. */
    public val validationErrors: List<FieldError>
        get() = problem.errors

    override val isRetryable: Boolean
        get() = status in setOf(408, 409, 429, 500, 502, 503, 504)

    private companion object {
        fun formatMessage(status: Int, problem: Problem): String = buildString {
            append(status)
            append(' ')
            append(problem.title ?: "HTTP error")
            problem.detail?.let { append(" — ").append(it) }
            (problem.correlationId ?: problem.legacyCorrelationId)?.let { append(" (correlationId: ").append(it).append(')') }
        }
    }
}

/** The request never reached the server, or the connection dropped. */
public class ConnectionException(
    message: String = "connection error",
    cause: Throwable? = null,
) : UarpException(message, cause) {
    override val isRetryable: Boolean get() = true
}

/** The request exceeded its timeout. */
public class TimeoutException(
    message: String = "request timed out",
    cause: Throwable? = null,
) : UarpException(message, cause) {
    override val isRetryable: Boolean get() = true
}

/** The response body did not match the expected shape. */
public class DecodingException(
    message: String,
    /** The raw payload that failed to decode. */
    public val body: String,
    cause: Throwable? = null,
) : UarpException(message, cause)

/** The client was configured with something unusable. */
public class ConfigurationException(message: String) : UarpException(message)

/** The event stream failed mid-flight. */
public class StreamException(message: String, cause: Throwable? = null) : UarpException(message, cause)

/** A raw JSON payload, used where the API declares a free-form value. */
public typealias Json = JsonElement
