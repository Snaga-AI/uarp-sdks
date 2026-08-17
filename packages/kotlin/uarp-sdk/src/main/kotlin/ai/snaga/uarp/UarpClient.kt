package ai.snaga.uarp

import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.min
import kotlin.math.pow
import kotlin.random.Random
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json as KJson
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/** JSON codec shared by the transport and the generated models. */
public val uarpJson: KJson = KJson {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = false
    isLenient = true
}

/** A file to upload through one of the `multipart/form-data` endpoints. */
@kotlinx.serialization.Serializable
public data class FilePart(
    val filename: String,
    val data: ByteArray,
    val contentType: String? = null,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is FilePart) return false
        return filename == other.filename && contentType == other.contentType && data.contentEquals(other.data)
    }

    override fun hashCode(): Int {
        var result = filename.hashCode()
        result = 31 * result + (contentType?.hashCode() ?: 0)
        result = 31 * result + data.contentHashCode()
        return result
    }
}

/** One part of a multipart request. */
public sealed interface Part {
    public val name: String

    public data class Text(override val name: String, val value: String) : Part
    public data class File(override val name: String, val file: FilePart) : Part
}

/** Request body variants the transport knows how to send. */
public sealed interface Body {
    public data class Json(val payload: String) : Body
    public data class Raw(val bytes: ByteArray, val contentType: String) : Body {
        override fun equals(other: Any?): Boolean =
            this === other || (other is Raw && contentType == other.contentType && bytes.contentEquals(other.bytes))

        override fun hashCode(): Int = 31 * bytes.contentHashCode() + contentType.hashCode()
    }
    public data class Multipart(val parts: List<Part>) : Body
}

/** Per-call overrides. */
public data class RequestOptions(
    val timeoutMillis: Long? = null,
    val maxRetries: Int? = null,
    /** Extra headers for this call. */
    val headers: Map<String, String> = emptyMap(),
    /** Reuse a specific idempotency key, e.g. to safely replay a create. */
    val idempotencyKey: String? = null,
    /** Extra query parameters merged into the generated ones. */
    val query: List<Pair<String, String>> = emptyList(),
    val baseUrl: String? = null,
    /** SSE-only knobs; ignored by unary requests. */
    val stream: StreamOptions = StreamOptions(),
)

/** The wire description a generated method hands to the transport. */
public data class RequestSpec(
    val method: String,
    val path: String,
    val query: List<Pair<String, String>> = emptyList(),
    val headers: List<Pair<String, String>> = emptyList(),
    val body: Body? = null,
    /** Adds an `Idempotency-Key`, which also makes the write safe to retry. */
    val idempotent: Boolean = false,
    val options: RequestOptions = RequestOptions(),
)

/**
 * Client for the UARP platform API.
 *
 * ```kotlin
 * val client = UarpClient.builder().apiKey(key).build()
 * val page = client.agents.list(limit = 20)
 * ```
 *
 * The instance is thread-safe and cheap to share; it owns one OkHttp
 * connection pool.
 */
public class UarpClient internal constructor(
    public val apiKey: String,
    public val baseUrl: HttpUrl,
    public val http: OkHttpClient,
    public val maxRetries: Int,
    public val defaultHeaders: Map<String, String>,
    public val userAgent: String,
    /** Send the API key as `?token=` on SSE requests instead of a header. */
    public val sseTokenInQuery: Boolean,
) {
    /** Fluent configuration. */
    public class Builder {
        private var apiKey: String? = null
        private var baseUrl: String = DEFAULT_BASE_URL
        private var timeoutMillis: Long = 60_000
        private var maxRetries: Int = 2
        private var defaultHeaders: MutableMap<String, String> = mutableMapOf()
        private var userAgentSuffix: String? = null
        private var http: OkHttpClient? = null
        private var sseTokenInQuery: Boolean = false

        public fun apiKey(value: String): Builder = apply { apiKey = value }

        public fun baseUrl(value: String): Builder = apply { baseUrl = value }

        /** Per-request timeout. Default 60 s. */
        public fun timeoutMillis(value: Long): Builder = apply { timeoutMillis = value }

        /** Retries for transient failures. Default 2. */
        public fun maxRetries(value: Int): Builder = apply { maxRetries = value }

        public fun defaultHeader(name: String, value: String): Builder = apply { defaultHeaders[name] = value }

        /** Appended to the SDK's own User-Agent. */
        public fun userAgentSuffix(value: String): Builder = apply { userAgentSuffix = value }

        /** Supply a preconfigured OkHttp client (interceptors, proxies, certificate pinning). */
        public fun httpClient(value: OkHttpClient): Builder = apply { http = value }

        public fun sseTokenInQuery(value: Boolean): Builder = apply { sseTokenInQuery = value }

        public fun build(): UarpClient {
            val key = apiKey
                ?: throw ConfigurationException("missing API key: call apiKey(...) or UarpClient.fromEnvironment()")
            val url = baseUrl.trimEnd('/').toHttpUrlOrNull()
                ?: throw ConfigurationException("invalid base URL: $baseUrl")
            val client = (http ?: OkHttpClient()).newBuilder()
                .callTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
                // Read timeout is disabled so SSE responses are not cut short;
                // unary calls are bounded by the call timeout above.
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .build()
            val agent = buildString {
                append("uarp-sdk-kotlin/").append(SDK_VERSION)
                userAgentSuffix?.let { append(' ').append(it) }
            }
            return UarpClient(key, url, client, maxRetries, defaultHeaders.toMap(), agent, sseTokenInQuery)
        }
    }

    public companion object {
        public fun builder(): Builder = Builder()

        /** Read `UARP_API_KEY` (or `SNAGA_API_KEY`) and `UARP_BASE_URL` from the environment. */
        public fun fromEnvironment(): UarpClient {
            // A set-but-empty variable is the environment's version of the
            // mistake an omitted key is, so it is refused here rather than
            // quietly building a credential-less client. Going keyless is a
            // deliberate act: `apiKey("")` on the builder, never an empty env.
            val key = System.getenv("UARP_API_KEY")?.takeIf { it.isNotEmpty() }
                ?: System.getenv("SNAGA_API_KEY")?.takeIf { it.isNotEmpty() }
                ?: throw ConfigurationException("UARP_API_KEY is not set")
            val builder = builder().apiKey(key)
            System.getenv("UARP_BASE_URL")?.let { builder.baseUrl(it) }
            return builder.build()
        }

        private val RETRYABLE = setOf(408, 409, 429, 500, 502, 503, 504)
    }

    // ---------------------------------------------------------- transport

    /** Send a request and return the decoded response body. */
    public suspend inline fun <reified T> request(spec: RequestSpec): T {
        val body = requestText(spec)
        return try {
            uarpJson.decodeFromString<T>(if (body.isBlank()) "null" else body)
        } catch (error: Exception) {
            throw DecodingException("failed to decode response body: ${error.message}", body, error)
        }
    }

    /** Send a request and discard the response body. */
    public suspend fun requestUnit(spec: RequestSpec) {
        execute(spec).use { it.body?.close() }
    }

    /** Send a request and return the raw response bytes (file downloads). */
    public suspend fun requestBytes(spec: RequestSpec): ByteArray =
        execute(spec).use { it.body?.bytes() ?: ByteArray(0) }

    /** Send a request and return the response body as text. */
    public suspend fun requestText(spec: RequestSpec): String =
        execute(spec).use { it.body?.string().orEmpty() }

    /** Perform the call, retrying transient failures, and return a successful response. */
    public suspend fun execute(spec: RequestSpec): Response {
        val retries = spec.options.maxRetries ?: maxRetries
        val idempotencyKey = if (spec.idempotent) spec.options.idempotencyKey ?: UUID.randomUUID().toString() else null
        val canRetry = spec.method == "GET" || spec.method == "HEAD" || idempotencyKey != null
        var attempt = 0

        while (true) {
            val request = buildRequest(spec, idempotencyKey)
            val response = try {
                httpFor(spec.options).newCall(request).await()
            } catch (error: IOException) {
                val mapped = if (error is java.io.InterruptedIOException) {
                    TimeoutException(cause = error)
                } else {
                    ConnectionException(error.message ?: "connection error", error)
                }
                if (!canRetry || attempt >= retries) throw mapped
                delay(backoffMillis(attempt))
                attempt++
                continue
            }

            if (response.isSuccessful) return response

            val headers = response.headers.toMap()
            val text = response.use { it.body?.string().orEmpty() }
            val problem = parseProblem(text)
            val shouldRetry = response.code in RETRYABLE &&
                headers["x-should-retry"] != "false" &&
                canRetry &&
                attempt < retries
            if (!shouldRetry) {
                throw ApiException(response.code, problem, headers, text.ifBlank { null })
            }
            val wait = headers["retry-after"]?.toDoubleOrNull()?.times(1000)?.toLong() ?: backoffMillis(attempt)
            attempt++
            delay(min(wait, 60_000))
        }
    }

    /** Open a server-sent event stream. */
    public fun stream(spec: RequestSpec): kotlinx.coroutines.flow.Flow<ServerEvent> = sseFlow(this, spec)

    internal fun buildRequest(spec: RequestSpec, idempotencyKey: String?, accept: String = "application/json"): Request {
        val base = spec.options.baseUrl?.trimEnd('/')?.toHttpUrlOrNull() ?: baseUrl
        val url = base.newBuilder()
            // Generated paths already percent-encode their segments.
            .addEncodedPathSegments(spec.path.trimStart('/'))
            .apply {
                //  Encoded here rather than by OkHttp: its own rules leave some
                //  sub-delimiters alone, and the five SDKs have to match.
                for ((name, value) in spec.query + spec.options.query) {
                    addEncodedQueryParameter(encodeQueryComponent(name), encodeQueryComponent(value))
                }
            }
            .build()

        val builder = Request.Builder()
            .url(url)
            .header("Accept", accept)
            .header("User-Agent", userAgent)
        // An empty key means "no credentials" — a guest/public client, or one
        // whose credentials travel another way. `Bearer ` with nothing after
        // it is NOT the same as sending no header: a server that validates the
        // value can refuse it. TypeScript and Swift already draw this line.
        if (apiKey.isNotEmpty()) builder.header("Authorization", "Bearer $apiKey")
        for ((name, value) in defaultHeaders) builder.header(name, value)
        for ((name, value) in spec.headers) builder.header(name, value)
        idempotencyKey?.let { builder.header("Idempotency-Key", it) }
        for ((name, value) in spec.options.headers) builder.header(name, value)

        val requestBody: RequestBody? = when (val body = spec.body) {
            //  Encoded as bytes on purpose: OkHttp appends `; charset=utf-8`
            //  to a string body, and the other four SDKs send a bare
            //  `application/json`.
            is Body.Json -> body.payload.toByteArray(Charsets.UTF_8).toRequestBody(JSON_MEDIA_TYPE)
            is Body.Raw -> body.bytes.toRequestBody(body.contentType.toMediaType())
            is Body.Multipart -> MultipartBody.Builder().setType(MultipartBody.FORM).apply {
                for (part in body.parts) {
                    when (part) {
                        is Part.Text -> addFormDataPart(part.name, part.value)
                        is Part.File -> addFormDataPart(
                            part.name,
                            part.file.filename,
                            part.file.data.toRequestBody(
                                (part.file.contentType ?: "application/octet-stream").toMediaType(),
                            ),
                        )
                    }
                }
            }.build()
            null -> null
        }

        return builder.method(spec.method, requestBody ?: emptyBodyFor(spec.method)).build()
    }

    /** An OkHttp client honouring this call's timeout override, sharing the pool. */
    internal fun httpFor(options: RequestOptions): OkHttpClient {
        val timeout = options.timeoutMillis ?: return http
        return http.newBuilder().callTimeout(timeout, TimeUnit.MILLISECONDS).build()
    }
}

private val JSON_MEDIA_TYPE = "application/json".toMediaType()

private fun emptyBodyFor(method: String): RequestBody? =
    if (method == "POST" || method == "PUT" || method == "PATCH" || method == "DELETE") {
        ByteArray(0).toRequestBody(null)
    } else {
        null
    }

internal fun okhttp3.Headers.toMap(): Map<String, String> =
    (0 until size).associate { index -> name(index).lowercase() to value(index) }

internal fun parseProblem(body: String): Problem =
    if (body.isBlank()) {
        Problem()
    } else {
        runCatching { uarpJson.decodeFromString<Problem>(body) }.getOrElse { Problem(detail = body.take(2_000)) }
    }

/** Full-jitter exponential backoff capped at 8 s. */
internal fun backoffMillis(attempt: Int): Long {
    val capped = min(8_000.0, 500.0 * 2.0.pow(attempt))
    return (capped * Random.nextDouble(0.5, 1.0)).toLong()
}

/** Bridge OkHttp's callback API to a cancellable coroutine. */
internal suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) {
            continuation.resume(response)
        }

        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isCancelled) return
            continuation.resumeWithException(e)
        }
    })
    continuation.invokeOnCancellation { runCatching { cancel() } }
}
