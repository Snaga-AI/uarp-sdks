# Changelog

All five SDKs share one version, cut from one tag. Set it with
`scripts/set-version.sh <version>`, which also regenerates.

The format follows [Keep a Changelog](https://keepachangelog.com/1.1.0/), and
the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## 0.5.1 — 2026-08-16

### Added — Swift only

- **`UARPClient.sendRaw(_ spec:) -> (Data, HTTPURLResponse)`**, a transport-only
  primitive that retries transient failures (the retryable status codes, timeouts,
  dropped connections) exactly as `send` does but returns the terminal response —
  success OR failure — instead of throwing on a non-2xx. A consumer that decodes
  responses through its own tolerant decoder (notably the iOS app, which keeps its
  own model layer) needs the raw bytes of an error body: some endpoints refuse
  with a bare `{"error":"…"}` rather than an RFC 9457 document, and `send`/`sendData`
  discard that body when they throw `UARPError.api`. `sendRaw` hands it back. The
  existing `send`/`sendData`/`sendVoid` thin over the same retry core, unchanged.

### Changed — Swift only

- **An empty `apiKey` now omits the `Authorization` header** instead of sending
  `Bearer ` with nothing after it. A guest or public client (`Configuration(apiKey:
  "")`) carries no credentials; `Bearer ` is not the same as no header, and a server
  that validates the header value can refuse it.

The TypeScript, Rust, Kotlin and Ada packages are re-versioned to 0.5.1 to keep the
single shared version, with no code change.

## 0.5.0 — 2026-08-16

### Changed — breaking (Swift only)

- **The Swift package's module is now `UARPSDK`.** It was `UARP`, the same name
  as the iOS app target that is its first consumer — a Swift app cannot `import`
  a module with the same name as its own module, so the two could not coexist.
  Renaming the SDK module (rather than the app) is the cheaper fix and aligns
  Swift with the other four SDKs, which all ship as `uarp-sdk` / `uarp_sdk` /
  `ai.snaga:uarp-sdk`. `import UARP` becomes `import UARPSDK`. There were no
  Swift consumers before this release, so nothing breaks. The package directory
  (`Sources/UARP`), the generated output and the request wire are unchanged; the
  rename is compile-time only.

The TypeScript, Rust, Kotlin and Ada packages are re-versioned to 0.5.0 to keep
the single shared version, with no code change.

## 0.4.0 — 2026-08-16

Every SDK now reads the platform's real event stream. Until this release only
the Kotlin parser handled the three wire shapes the platform emits; the other
four silently dropped everything that was not a standard `text/event-stream`
frame, so a run that looked complete on Kotlin was empty on TypeScript, Rust,
Swift and Ada.

### Added

- **SSE parser parity across all five SDKs.** The TypeScript, Rust, Swift and
  Ada parsers now handle the three wire shapes the platform emits — standard
  `text/event-stream`; a JSON object carried in an SSE comment
  (`:{"type":"…","event_id":"…"}`); and bare NDJSON (`{"type":"…","event_id":"…"}`)
  — plus the `data: [DONE]` hard terminal. A shared decode-parity fixture
  (`contract/sse-fixtures/`) is replayed field-by-field by every SDK and locked
  against the Kotlin reference, so the five cannot drift apart again.
- **Reconnect loop, opt-in.** `StreamOptions` (each language's idiomatic name)
  adds: terminal events that stop the stream without reconnect; an inactivity
  watchdog that reconnects on a silent-but-open socket; HTTP 401 surfacing
  without retry; `Last-Event-ID` resume that replaces a caller-supplied id only
  once an event has been delivered; a stability reset of the reconnect attempt
  counter; and a `Connecting → Connected → Reconnecting → Disconnected` state
  callback. Defaults preserve standard-SSE behaviour, so existing callers see
  no change.

## 0.3.0 — 2026-08-14

Regenerated from a corrected API document, and one fix that matters more
than the rest.

### Fixed

- **Paginated collections came back empty.** Every `*All` walker stopped at
  the first page with no items, and this API returns exactly that: it applies
  the page size before filtering, so a request for two items answers with none
  while `has_more` is still true. Callers were told a collection was empty when
  it was not — silently, with no error to notice. An empty page no longer ends
  the walk; a server that never yields anything is stopped after three empty
  pages in a row, and the repeated-cursor guard still bounds a server that never
  clears its cursor. Affects TypeScript, Rust, Swift and Kotlin; the Ada walker
  was already correct.

### Changed — breaking

The API document changed shape and the generated surface followed it.

- **`AgentModelConfig` no longer carries `provider`, `model_ref`,
  `endpoint_url` or `api_key_ref`**, and the `AgentModelConfigProvider`
  enumeration is gone with them. The platform selects the model itself; the
  response now describes capabilities only. Requests take
  `AgentModelConfigInput`, which the document states is accepted and ignored —
  so creating an agent is just a name.
- **`GetHealthResponse.status` is an enumeration** (`healthy`, `degraded`,
  `unhealthy`) rather than free text, and the four properties `/health` always
  returned are described at last.
- Required properties corrected across `ConstitutionRule`, `Integration`,
  `BridgeConnection`, `GovernanceLedgerEntry` and `DesignRequest`, and twelve
  input schemas added. 603 models where 0.2.0 had 575.

Code written against 0.2.0 that sets a model on create, or reads a provider
off an agent, will not compile. Both were already ignored by the platform.

### Known

The API document declares itself `0.2.0` in both releases although its content
changed between them, so the SDK version is the only thing that tracks it.

## 0.2.0 — 2026-08-14

First release. Generated from UARP spec version 0.2.0: 557 operations across
43 resource groups, 575 models, 11 event streams, 14 cursor-paginated
endpoints.

### Added

- **TypeScript / Node** (`uarp-sdk` on npm) — ESM, no runtime dependencies,
  Node 18+.
- **Rust** (`uarp-sdk` on crates.io) — `reqwest` + `serde` + `tokio`, rustls by
  default, MSRV 1.88.
- **Swift** (`UARP` via SwiftPM) — `async`/`await` over `URLSession`, macOS 12 /
  iOS 15 and up, no dependencies.
- **Kotlin / Android** (`ai.snaga:uarp-sdk`) — coroutines, OkHttp,
  kotlinx.serialization, Java 11 bytecode.
- **Ada** (`uarp_sdk` on Alire) — Ada 2022 over libcurl with GNATCOLL.JSON.

Every SDK covers the whole API surface and shares the same behaviour:

- Bearer authentication, falling back to `UARP_API_KEY` / `SNAGA_API_KEY`.
- An `Idempotency-Key` on every mutating `/api/v1/*` request, which is also
  what makes a write safe to retry.
- Retries for `408`, `409`, `429`, `500`, `502`, `503`, `504` and dropped
  connections, with
  full-jitter backoff honouring `Retry-After` and `X-Should-Retry: false`.
- RFC 9457 problem documents parsed into typed errors carrying the status,
  detail, `correlationId` and field-level validation failures.
- Event streams as a native async type, reconnecting with `Last-Event-ID`.
- An extra method per paginated endpoint that walks every page.
- Enum values the server adds later decode instead of failing.


### Fixed before release

Nothing below shipped to anyone: these are defects found while building the
five SDKs against each other and against the live API, kept because each one
documents behaviour a caller can rely on.

- **Rust:** `rust-version` said 1.75 and the crate had never been built with it.
  The floor is 1.88, set by the `icu_*` crates that `url` pulls in, not by
  anything in this SDK — a caller on 1.75 would have got a failure inside a
  dependency's manifest. CI now builds the crate with whatever version the
  manifest promises, so the two cannot drift apart again.
- **Ada:** streaming is reentrant. The parser and handler used to live in a
  package-level variable, so only one event stream could run per process.
  Handlers are now an `Event_Sink` interface whose state lives on the caller's
  stack — which also removes the rule that a handler had to be a library-level
  subprogram. libcurl's global initialisation is serialised behind a protected
  object.
- **Swift:** a query value containing `+` was sent unescaped, and a server
  applying form-decoding rules read it back as a space. Query components are now
  percent-encoded by hand rather than by `URLQueryItem`.
- **All five:** query names and values are percent-encoded to the same rule —
  everything outside the RFC 3986 unreserved set is escaped, spaces included
  (`%20`, not `+`). The SDKs previously used three different sets of "safe"
  characters, which decoded the same under form rules but not under RFC 3986.
- **Kotlin:** JSON bodies are sent as `Content-Type: application/json` rather
  than `application/json; charset=utf-8`. OkHttp appends the charset to a
  string body; the other four SDKs send it bare.
- **Ada:** a required free-form `object` field defaults to `{}` rather than
  JSON null, so a caller who leaves it unset no longer sends a value of the
  wrong type.
- **Kotlin:** models whose schema declares `additionalProperties` keep the keys
  they do not model and send them back unchanged, matching Swift, Rust and Ada.
- **Ada:** event streams now reopen with `Last-Event-ID` when the connection
  ends, which the documentation already claimed for all five SDKs. A connection
  that delivered at least one event earns a fresh reconnect budget;
  `Request_Options.Reconnect` and `.Max_Reconnects` bound it.
- **Ada:** failures now carry the response headers, so `Retry-After` and the
  rate-limit hints are reachable through `UARP.Errors.Retry_After_Seconds`,
  `Rate_Limit_Remaining` and `Rate_Limit_Reset`. They were parsed by the
  transport and then discarded.
- **Ada:** a binary download containing a NUL byte was truncated at that byte.
  `Interfaces.C.Strings.Value` stops at the first NUL regardless of the length
  it is given, so the response body is now copied through an address overlay of
  the exact length libcurl reported.

### Changed

- **Rust:** per-call overrides, which the other four SDKs already had. Rust has
  no default arguments, so rather than an options parameter on all 557 methods
  they ride on a cheap clone of the client that shares its connection pool:
  `client.with_idempotency_key(..)`, `.with_timeout(..)`, `.with_max_retries(..)`,
  `.with_header(..)`, `.with_query(..)`, `.with_stream_options(..)`, or
  `.with_options(RequestOptions { .. })`. Generated streaming methods no longer
  take a `StreamOptions` argument; it comes from the clone.
- The SDK version now comes from the repository `VERSION` file, which the
  generator bakes into each package's metadata; `scripts/set-version.sh` sets
  it everywhere at once.

### Also in this release

- **Publishing is documented and the Swift package is reachable.** SwiftPM
  resolves a git URL and expects `Package.swift` at the repository root, so a
  package in a monorepo subdirectory cannot be depended upon at all. The release
  now copies `packages/swift` into `Snaga-AI/uarp-swift` and tags it there.
  PUBLISHING.md covers the accounts, the DNS record that proves the Maven
  namespace, the signing key, and the order to publish in.
- **Every package carries its LICENCE.** All five declared MIT in their metadata
  and shipped no licence text; npm even listed a file that was not there.
- **Live conformance probe** (`smoke/`, `make smoke`). Calls the whole
  documented surface against a running server in dependency order, validates
  every response against the schema that promised it, and writes a report for
  the backend team. Requests carry the documented minimum — each required
  property and nothing else — so a rejection means the endpoint enforces a rule
  the document never states. Writes that have a matching read echo it back
  unchanged, which exercises configuration endpoints without altering them.
  Deletes only target identifiers the run created; `smoke/quarantine.json` names
  the calls it will not make on its own. Requests go through the TypeScript
  SDK's own transport, so the run exercises shipped code.
- **Live SDK scenario** (`smoke/live/`). One fixed sequence through all five
  SDKs against a real server, comparing what each decoded. It is the only check
  that puts the Rust, Swift, Kotlin and Ada transports against real TLS and real
  infrastructure rather than a local mock, and a value an SDK cannot decode is
  reported rather than raised, so the disagreement shows up in the comparison
  instead of a stack trace.
- Release workflow covering npm, crates.io, Maven Central, a GitHub release and
  an Alire submission tarball, with a dry run through `workflow_dispatch`.
- `node generator/src/index.ts --check` (also `make check`) reports every
  generated file that is missing, stale or left over. CI runs it instead of
  diffing the working tree, so the same check works locally without a commit.
- An emitter that meets a request body encoding it cannot render now stops the
  build instead of falling back to JSON. Only TypeScript implements
  `application/x-www-form-urlencoded`; no endpoint uses it yet.
- Generator test suite: unit tests for naming, IR assertions, golden files for
  all five emitters, and compile checks for the emitted TypeScript, Rust and
  Swift.
- Coverage for paths that had none: `X-Should-Retry: false`, `Retry-After` in
  its HTTP-date form, connection-failure retries, and the SSE token query
  parameter in all five SDKs.
- Multipart uploads and binary downloads are exercised end to end in all five
  SDKs, with a NUL and a high byte in the payload. Three of the five encoders
  are hand-written and had no coverage at all.
- Rate-limit and retry accessors are covered in every SDK, including the
  fallback from the problem document to the `X-Correlation-Id` header.
- A cross-SDK contract check (`make contract`): all five SDKs run the same
  seventeen-request scenario against one server, which records what each put on
  the wire, and the traces must match exactly — raw query string included, so
  `a+b` and `a%20b` are not treated as equal. It found every wire-format
  difference fixed above, including the Swift `+` bug. The scenario covers
  percent-encoding, multipart, binary bodies, retries, paging, event streams,
  falsy values that must not be dropped, and a string with a quote, a
  backslash, a newline, a tab and a character outside the basic plane. A final
  scenario compares decoding rather than sending: each SDK reports what it read
  out of one awkward payload — an unseen enum value, an explicit null, an
  absent optional, an empty array and an integer beyond 2^53 — and the reports
  are compared too. Differences that cannot be fixed are recorded in
  `contract/known-differences.json` with a reason.
- Every behavioural claim the READMEs make is now backed by a test in every
  SDK that makes it: stream reopening with `Last-Event-ID`, writes retrying
  only when they carry an idempotency key, caller-supplied keys, the cursor
  guard that stops a server which never clears its cursor, and enum values the
  API adds after generation.

### Tooling

- `generator/` turns `spec/openapi.json` into all five SDKs; the transport,
  error, retry, pagination and SSE layers are hand-written per package.
- Generator test suite: unit tests for naming, IR assertions against fixtures
  and the production document, golden files for all five emitters, and
  compile checks for the emitted TypeScript and Rust.
- `make test` builds and tests everything; CI runs the same matrix and fails if
  the checked-in output drifts from the emitters.
