package ai.snaga.uarp

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** RFC 9457 problem document returned by the API on failure. */
@Serializable
public data class Problem(
    val type: String? = null,
    val title: String? = null,
    val status: Int? = null,
    val detail: String? = null,
    /** Request identifier to quote when reporting an incident. */
    @SerialName("correlationId") val correlationId: String? = null,
    /** Field-level validation failures, present on 422 responses. */
    val errors: List<FieldError> = emptyList(),
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

    /** Request identifier for support tickets. */
    public val correlationId: String?
        get() = problem.correlationId ?: headers["x-correlation-id"]

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
            problem.correlationId?.let { append(" (correlationId: ").append(it).append(')') }
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
