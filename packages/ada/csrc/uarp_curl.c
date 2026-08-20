/*
 * Thin, non-variadic wrapper around libcurl for the Ada SDK.
 *
 * `curl_easy_setopt` is variadic, and on several ABIs (notably arm64 Apple)
 * variadic arguments are not passed the way a fixed prototype would pass them.
 * Rather than risk that, every call lives here in C and Ada talks to two plain
 * functions with fixed signatures.
 */
#include <curl/curl.h>
#include <stdlib.h>
#include <string.h>

/* The C shim returns this when the inactivity watchdog
 * (CURLOPT_LOW_SPEED_TIMEOUT / CURLOPT_LOW_SPEED_LIMIT) fires, so the Ada
 * side can branch on a soft "silent socket, reconnect" outcome rather than
 * overloading the CURLcode.  Chosen well outside the CURLcode range (0-99). */
#define UARP_STREAM_SILENT 1000L

typedef struct {
    char  *data;
    size_t len;
    size_t cap;
} uarp_buf;

static int buf_reserve(uarp_buf *buf, size_t extra)
{
    if (buf->len + extra + 1 <= buf->cap) {
        return 1;
    }
    size_t cap = buf->cap ? buf->cap : 4096;
    while (cap < buf->len + extra + 1) {
        cap *= 2;
    }
    char *grown = (char *) realloc(buf->data, cap);
    if (!grown) {
        return 0;
    }
    buf->data = grown;
    buf->cap = cap;
    return 1;
}

static size_t buf_write(void *ptr, size_t size, size_t nmemb, void *userdata)
{
    uarp_buf *buf = (uarp_buf *) userdata;
    size_t total = size * nmemb;
    if (!buf_reserve(buf, total)) {
        return 0;
    }
    memcpy(buf->data + buf->len, ptr, total);
    buf->len += total;
    buf->data[buf->len] = '\0';
    return total;
}

/* Called from Ada for every streamed chunk; a short return aborts the transfer. */
typedef size_t (*uarp_sink)(void *ctx, const char *data, size_t len);

typedef struct {
    uarp_sink sink;
    void     *ctx;
} uarp_stream_target;

static size_t stream_write(void *ptr, size_t size, size_t nmemb, void *userdata)
{
    uarp_stream_target *target = (uarp_stream_target *) userdata;
    size_t total = size * nmemb;
    return target->sink(target->ctx, (const char *) ptr, total);
}

static struct curl_slist *build_headers(const char *const *headers, int count)
{
    struct curl_slist *list = NULL;
    for (int i = 0; i < count; i++) {
        list = curl_slist_append(list, headers[i]);
    }
    /* Let the caller decide; libcurl's default Expect: 100-continue stalls small posts. */
    list = curl_slist_append(list, "Expect:");
    return list;
}

static CURL *make_handle(const char *method,
                         const char *url,
                         struct curl_slist *header_list,
                         const char *body,
                         size_t body_len,
                         long timeout_ms,
                         char *err)
{
    CURL *handle = curl_easy_init();
    if (!handle) {
        return NULL;
    }
    curl_easy_setopt(handle, CURLOPT_URL, url);
    curl_easy_setopt(handle, CURLOPT_CUSTOMREQUEST, method);
    curl_easy_setopt(handle, CURLOPT_HTTPHEADER, header_list);
    /* Redirects are NOT followed, and that is a decision about the wire.
     *
     * The API documents exactly three 3xx responses, all of them browser
     * OAuth hops (`/auth/oauth/{provider}/start`, both callbacks); no data
     * endpoint redirects. Following one therefore never serves an SDK
     * caller -- but it does hand libcurl a destination the caller never
     * named, on a host the caller never named, which is precisely what a
     * client sitting behind an egress policy must not do. A caller that
     * wants the hop reads `location` out of the response headers and
     * decides for itself.
     *
     * CURLOPT_REDIR_PROTOCOLS is deliberately NOT set instead: it guards
     * the scheme, never the host, so it would leave the actual gap open
     * while looking like it had been closed.
     *
     * If you turn this back on, `Test_Redirect_Not_Followed` fails.
     */
    curl_easy_setopt(handle, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(handle, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(handle, CURLOPT_ERRORBUFFER, err);
    curl_easy_setopt(handle, CURLOPT_ACCEPT_ENCODING, "");
    if (timeout_ms > 0) {
        curl_easy_setopt(handle, CURLOPT_TIMEOUT_MS, timeout_ms);
    }
    if (body) {
        curl_easy_setopt(handle, CURLOPT_POSTFIELDS, body);
        curl_easy_setopt(handle, CURLOPT_POSTFIELDSIZE_LARGE, (curl_off_t) body_len);
    } else if (strcmp(method, "POST") == 0 || strcmp(method, "PUT") == 0 ||
               strcmp(method, "PATCH") == 0) {
        curl_easy_setopt(handle, CURLOPT_POSTFIELDS, "");
        curl_easy_setopt(handle, CURLOPT_POSTFIELDSIZE_LARGE, (curl_off_t) 0);
    }
    return handle;
}

/* Initialise libcurl once per process. Returns 0 on success. */
long uarp_curl_init(void)
{
    static int done = 0;
    if (done) {
        return 0;
    }
    CURLcode code = curl_global_init(CURL_GLOBAL_DEFAULT);
    done = (code == CURLE_OK);
    return (long) code;
}

/*
 * Perform one request, buffering the whole response.
 *
 * Returns the CURLcode (0 on success). `*out_body` and `*out_headers` are
 * heap-allocated NUL-terminated buffers the caller must release with
 * `uarp_free`; they are also valid when the HTTP status is an error.
 */
long uarp_http_request(const char *method,
                       const char *url,
                       const char *const *headers,
                       int header_count,
                       const char *body,
                       size_t body_len,
                       long timeout_ms,
                       long *out_status,
                       char **out_body,
                       size_t *out_body_len,
                       char **out_headers,
                       size_t *out_headers_len,
                       char *err)
{
    uarp_buf response = {0};
    uarp_buf response_headers = {0};
    struct curl_slist *header_list = build_headers(headers, header_count);

    err[0] = '\0';
    CURL *handle = make_handle(method, url, header_list, body, body_len, timeout_ms, err);
    if (!handle) {
        curl_slist_free_all(header_list);
        return (long) CURLE_FAILED_INIT;
    }

    curl_easy_setopt(handle, CURLOPT_WRITEFUNCTION, buf_write);
    curl_easy_setopt(handle, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(handle, CURLOPT_HEADERFUNCTION, buf_write);
    curl_easy_setopt(handle, CURLOPT_HEADERDATA, &response_headers);

    CURLcode code = curl_easy_perform(handle);
    long status = 0;
    curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, &status);

    *out_status = status;
    *out_body = response.data;
    *out_body_len = response.len;
    *out_headers = response_headers.data;
    *out_headers_len = response_headers.len;

    curl_easy_cleanup(handle);
    curl_slist_free_all(header_list);
    return (long) code;
}

/*
 * Perform a streaming request, handing every chunk to `sink`.
 *
 * A sink return value other than the chunk length aborts the transfer, which
 * surfaces as CURLE_WRITE_ERROR (23) — the Ada side treats that as a clean stop.
 *
 * When `inactivity_timeout_seconds > 0`, the inactivity watchdog
 * (CURLOPT_LOW_SPEED_TIMEOUT / CURLOPT_LOW_SPEED_LIMIT) aborts the transfer if
 * the socket goes silent for that many seconds.  That outcome is mapped to
 * UARP_STREAM_SILENT so the Ada side can reconnect rather than treating the
 * silence as a finished stream.
 */
long uarp_http_stream(const char *method,
                      const char *url,
                      const char *const *headers,
                      int header_count,
                      const char *body,
                      size_t body_len,
                      long timeout_ms,
                      long inactivity_timeout_seconds,
                      uarp_sink sink,
                      void *ctx,
                      long *out_status,
                      char *err)
{
    struct curl_slist *header_list = build_headers(headers, header_count);
    uarp_stream_target target = {sink, ctx};

    err[0] = '\0';
    CURL *handle = make_handle(method, url, header_list, body, body_len, timeout_ms, err);
    if (!handle) {
        curl_slist_free_all(header_list);
        return (long) CURLE_FAILED_INIT;
    }

    curl_easy_setopt(handle, CURLOPT_WRITEFUNCTION, stream_write);
    curl_easy_setopt(handle, CURLOPT_WRITEDATA, &target);
    /* Deliver bytes as they arrive rather than in buffer-sized gulps. */
    curl_easy_setopt(handle, CURLOPT_BUFFERSIZE, 4096L);

    /* Inactivity watchdog: if the transfer speed drops below 1 byte/second
     * for `inactivity_timeout_seconds` seconds, abort with a soft timeout
     * that the Ada side maps to a reconnect.  When 0, the options are not
     * set and EOF owns liveness (the existing behavior). */
    if (inactivity_timeout_seconds > 0) {
        curl_easy_setopt(handle, CURLOPT_LOW_SPEED_TIME, inactivity_timeout_seconds);
        curl_easy_setopt(handle, CURLOPT_LOW_SPEED_LIMIT, 1L);
    }

    CURLcode code = curl_easy_perform(handle);
    long status = 0;
    curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, &status);
    *out_status = status;

    curl_easy_cleanup(handle);
    curl_slist_free_all(header_list);

    /* Map the inactivity-watchdog timeout to a soft "silent socket" outcome
     * so the Ada side reconnects rather than raising a transport error. */
    if (code == CURLE_OPERATION_TIMEDOUT && inactivity_timeout_seconds > 0) {
        return UARP_STREAM_SILENT;
    }
    return (long) code;
}

void uarp_free(char *pointer)
{
    free(pointer);
}

/* Human-readable text for a CURLcode. */
const char *uarp_curl_strerror(long code)
{
    return curl_easy_strerror((CURLcode) code);
}