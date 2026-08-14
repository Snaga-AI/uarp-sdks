# ai.snaga:uarp-sdk

Kotlin client for the **UARP — Universal Agent Runtime Platform** API, built for
Android and any JVM. Full coverage of all 557 endpoints, coroutines throughout,
OkHttp + kotlinx.serialization.

```kotlin
dependencies {
    implementation("ai.snaga:uarp-sdk:0.2.0")
}
```

Java 11 bytecode, so Android `minSdk 21` (with core library desugaring) and up.
The artifact brings OkHttp 4.12, kotlinx-serialization-json and
kotlinx-coroutines-core with it.

## Quick start

```kotlin
val client = UarpClient.builder()
    .apiKey(BuildConfig.UARP_API_KEY)
    .build()

val agent = client.agents.create(
    CreateAgentRequest(
        name = "demo",
        model = AgentModelConfig(
            provider = AgentModelConfigProvider.OPENAI_COMPAT,
            modelRef = "gpt-4o-mini",
            capabilities = JsonObject(emptyMap()),
        ),
    ),
)

val page = client.agents.list(limit = 20)
```

`UarpClient.fromEnvironment()` reads `UARP_API_KEY` / `SNAGA_API_KEY` and
`UARP_BASE_URL`, which suits server-side use; on Android pass the key
explicitly.

Resource groups are extension properties: `client.agents`, `client.runs`,
`client.sessions`, … 43 in all, in `ai.snaga.uarp.api`. Every call is a
`suspend` function, so call them from a coroutine (`viewModelScope`,
`lifecycleScope`, …).

## Streaming

SSE endpoints return a cold `Flow<ServerEvent>` that reconnects with
`Last-Event-ID`:

```kotlin
client.runs.streamRunEvents(runId)
    .onEach { event ->
        if (event.event == "llm.chunk") append(event.decode<Chunk>().text)
    }
    .takeWhile { it.event != "run.completed" }
    .flowOn(Dispatchers.IO)
    .collect()
```

Cancelling the collecting coroutine closes the connection.

## Pagination

```kotlin
client.agents.listAll(limit = 100).collect { agent ->
    println(agent.name)
}

val first50 = client.agents.listAll().take(50).toList()
```

## Errors

```kotlin
try {
    client.agents.get(id)
} catch (error: ApiException) {
    when (error.kind) {
        ApiErrorKind.NOT_FOUND -> showMessage("No such agent")
        ApiErrorKind.UNPROCESSABLE_ENTITY -> showFieldErrors(error.validationErrors)
        ApiErrorKind.RATE_LIMIT -> retryAfter(error.retryAfterSeconds)
        else -> report(error.status, error.correlationId)
    }
} catch (error: TimeoutException) {
    showMessage("Timed out")
}
```

Everything the SDK throws derives from `UarpException`.

## Configuration

```kotlin
val client = UarpClient.builder()
    .apiKey(key)
    .baseUrl("http://10.0.2.2:8080")
    .timeoutMillis(30_000)
    .maxRetries(3)
    .defaultHeader("X-Tenant", "acme")
    .userAgentSuffix("my-app/1.2.3")
    .httpClient(myOkHttpClient)     // interceptors, certificate pinning, cache
    .build()
```

Per-call overrides go in the trailing `options` argument:

```kotlin
client.agents.create(request, options = RequestOptions(idempotencyKey = "order-4711"))
```

**Retries.** `408`, `409`, `429` and `5xx`, plus connection errors, retry with
full-jitter backoff (500 ms → 8 s) and honour `Retry-After`. Reads always retry;
writes only when they carry an idempotency key, which every mutating
`/api/v1/*` call sends automatically.

## Android notes

- Add `<uses-permission android:name="android.permission.INTERNET" />`.
- Calls suspend; run them on a coroutine scope, never on the main thread with
  `runBlocking`.
- With R8/ProGuard, kotlinx.serialization needs its usual keep rules:

  ```proguard
  -keepattributes *Annotation*, InnerClasses
  -dontnote kotlinx.serialization.**
  -keepclassmembers class ai.snaga.uarp.models.** { *; }
  -keepclasseswithmembers class ai.snaga.uarp.models.** {
      kotlinx.serialization.KSerializer serializer(...);
  }
  ```

- Provide the API key through a backend token exchange or `BuildConfig`, not a
  string literal in a shipped APK.

## Notes

- Fields the spec marks `required` are non-null; everything else is nullable
  with a `null` default. Unknown response fields are ignored, except on the
  models whose schema declares `additionalProperties`, which keep them in
  `additionalProperties: JsonObject` and send them back out unchanged.
- Enums are string-backed `value class`es with constants and `knownValues`, so a
  value the server adds later decodes instead of throwing.
- Integers are `Long` and timestamps are ISO-8601 `String`s.

## Development

```sh
./gradlew :uarp-sdk:test
./gradlew :uarp-sdk:assemble
```

Files under `uarp-sdk/src/main/kotlin/ai/snaga/uarp/generated/` come from
`generator/` in the repository root; edit the emitter, not the output.
