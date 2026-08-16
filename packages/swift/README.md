# UARPSDK (Swift)

Swift client for the **UARP — Universal Agent Runtime Platform** API. Full
coverage of all 557 endpoints, `async`/`await` throughout, no dependencies
beyond Foundation.

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/Snaga-AI/uarp-swift", from: "0.5.0"),
],
targets: [
    .target(name: "App", dependencies: [.product(name: "UARPSDK", package: "uarp-swift")]),
]
```

macOS 12+, iOS 15+, tvOS 15+, watchOS 8+, visionOS 1+, Swift 5.9+.


## Platforms

Built for Apple platforms: macOS 12+, iOS 15+, tvOS 15+, watchOS 8+, visionOS 1+.

The package also builds on Linux and every one of the 557 request/response
operations works there. The eleven event-stream endpoints do not:
`URLSession.bytes(for:)` is missing from swift-corelibs-foundation, and every
other way of reading a response on that platform buffers it to completion, which
never happens on a stream that stays open. Calling one on Linux throws
`UARPError.stream` with that explanation rather than failing to compile.

## Quick start

```swift
import UARPSDK

let client = try UARPClient.fromEnvironment()   // UARP_API_KEY, UARP_BASE_URL
// or: UARPClient(apiKey: "uarp_...")

// The platform selects the model itself, so a create is just a name.
let agent = try await client.agents.create(body: CreateAgentRequest(name: "demo"))

let page = try await client.agents.list(limit: 20)
```

**Getting a key.** Sign in at <https://snaga.ai> and create one in your tenant's
settings. A key looks like `uarp_<prefix>_<secret>`; the secret half is shown
once and never again. With a key that carries `tenants:write` you can mint more
through `POST /api/v1/tenants/me/keys`. Give each one the narrowest set of
scopes that does its job.

Resource groups are computed properties on the client: `client.agents`,
`client.runs`, `client.sessions`, … 43 in all. Parameters are flattened into
labelled arguments with `nil` defaults, so only what you set is sent.

## Streaming

SSE endpoints return an `EventStream`, an `AsyncSequence` that reconnects with
`Last-Event-ID`:

```swift
// The text arrives as `payload.delta`; the rest of the envelope is
// platform bookkeeping.
struct Chunk: Decodable {
    struct Payload: Decodable { let delta: String }
    let payload: Payload
}

for try await event in client.runs.streamRunEvents(runId: id) {
    if event.event == "llm.chunk" {
        print(try event.json(as: Chunk.self).payload.delta, terminator: "")
    }
    if event.event == "run.completed" { break }   // leaving the loop cancels the request
}

// Or wait for one event:
let done = try await client.runs.streamRunEvents(runId: id).until { $0.event == "run.completed" }
```

## Pagination

```swift
for try await agent in client.agents.listAll(limit: 100) {
    print(agent.name)
}

let firstPage = try await client.agents.listAll().collect(limit: 50)
```

An empty page does **not** end the walk. This API applies the page limit before
filtering, so a page can come back with no items and more behind it — reading
one as the end of the collection is what made 0.2.0 report empty lists. Three
empty pages in a row do stop it, as does a repeated cursor.

## Errors

```swift
do {
    _ = try await client.agents.get(agentId: id)
} catch let UARPError.api(error) {
    switch error.kind {
    case .notFound:            print("no such agent")
    case .unprocessableEntity: print(error.validationErrors)
    case .rateLimit:           print(error.retryAfterSeconds ?? 0)
    default:                   print(error.status, error.correlationId ?? "")
    }
} catch UARPError.timeout {
    print("timed out")
}
```

## Configuration

```swift
var configuration = Configuration(apiKey: key)
configuration.baseURL = URL(string: "http://localhost:8080")!
configuration.timeout = 30
configuration.maxRetries = 3
configuration.defaultHeaders = ["X-Tenant": "acme"]
configuration.userAgentSuffix = "my-app/1.2.3"

let client = UARPClient(configuration: configuration, session: .shared)
```

Per-call overrides use the trailing `options:` argument:

```swift
try await client.agents.create(
    body: request,
    options: RequestOptions(timeout: 5, maxRetries: 0, idempotencyKey: "order-4711")
)
```

**Retries.** `408`, `409`, `429`, `500`, `502`, `503` and `504`, plus connection errors, retry with
full-jitter backoff (0.5 s → 8 s) and honour `Retry-After`. Reads always retry;
writes only when they carry an idempotency key, which every mutating
`/api/v1/*` call sends automatically.

## Notes

- Enums are `RawRepresentable` structs with static constants rather than Swift
  `enum`s, so a value the API adds later decodes instead of throwing. Compare
  with `==`, list the known ones with `.knownValues`.
- Models that declare `additionalProperties` keep unmodelled keys in
  `additionalProperties: [String: JSONValue]`.
- A model named `Error` in the spec is emitted as `ErrorModel` so it does not
  shadow `Swift.Error`; the same rule applies to any other reserved name.
- Timestamps are ISO-8601 `String`s, not `Date`s.
- Pass `sseTokenInQuery: true` when a proxy strips the `Authorization` header
  from event-stream requests.

## Development

```sh
swift build
swift test
swift run uarp-example
```

Files under `Sources/UARP/Generated/` come from `generator/` in the repository
root; edit the emitter, not the output.
