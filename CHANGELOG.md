# Changelog

All five SDKs share one version, cut from one tag. Set it with
`scripts/set-version.sh <version>`, which also regenerates.

The format follows [Keep a Changelog](https://keepachangelog.com/1.1.0/), and
the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Fixed

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

### Added

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
  fifteen-request scenario against one server, which records what each put on
  the wire, and the traces must match exactly — raw query string included, so
  `a+b` and `a%20b` are not treated as equal. It found every wire-format
  difference fixed above, including the Swift `+` bug.
- Every behavioural claim the READMEs make is now backed by a test in every
  SDK that makes it: stream reopening with `Last-Event-ID`, writes retrying
  only when they carry an idempotency key, caller-supplied keys, the cursor
  guard that stops a server which never clears its cursor, and enum values the
  API adds after generation.

## 0.2.0

First release. Generated from UARP spec version 0.2.0: 557 operations across
43 resource groups, 575 models, 11 event streams, 14 cursor-paginated
endpoints.

### Added

- **TypeScript / Node** (`uarp-sdk` on npm) — ESM, no runtime dependencies,
  Node 18+.
- **Rust** (`uarp-sdk` on crates.io) — `reqwest` + `serde` + `tokio`, rustls by
  default, MSRV 1.75.
- **Swift** (`UARP` via SwiftPM) — `async`/`await` over `URLSession`, macOS 12 /
  iOS 15 and up, no dependencies.
- **Kotlin / Android** (`ai.snaga:uarp-sdk`) — coroutines, OkHttp,
  kotlinx.serialization, Java 11 bytecode.
- **Ada** (`uarp_sdk` on Alire) — Ada 2022 over libcurl with GNATCOLL.JSON.

Every SDK covers the whole API surface and shares the same behaviour:

- Bearer authentication, falling back to `UARP_API_KEY` / `SNAGA_API_KEY`.
- An `Idempotency-Key` on every mutating `/api/v1/*` request, which is also
  what makes a write safe to retry.
- Retries for `408`, `409`, `429`, `5xx` and dropped connections, with
  full-jitter backoff honouring `Retry-After` and `X-Should-Retry: false`.
- RFC 9457 problem documents parsed into typed errors carrying the status,
  detail, `correlationId` and field-level validation failures.
- Event streams as a native async type, reconnecting with `Last-Event-ID`.
- An extra method per paginated endpoint that walks every page.
- Enum values the server adds later decode instead of failing.

### Tooling

- `generator/` turns `spec/openapi.json` into all five SDKs; the transport,
  error, retry, pagination and SSE layers are hand-written per package.
- Generator test suite: unit tests for naming, IR assertions against fixtures
  and the production document, golden files for all five emitters, and
  compile checks for the emitted TypeScript and Rust.
- `make test` builds and tests everything; CI runs the same matrix and fails if
  the checked-in output drifts from the emitters.
