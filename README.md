# UARP SDKs

Client libraries for the **UARP — Universal Agent Runtime Platform** API
(<https://snaga.ai>), in five languages, generated from one OpenAPI document.

| Language | Package | Artifact | Requirements |
| --- | --- | --- | --- |
| TypeScript / Node | `packages/typescript` | `uarp-sdk` (npm) | Node 18+ |
| Rust | `packages/rust` | `uarp-sdk` (crates.io) | Rust 1.75+, Tokio |
| Swift | `packages/swift` | `UARP` (SwiftPM) | Swift 5.9+, macOS 12 / iOS 15 |
| Kotlin / Android | `packages/kotlin` | `ai.snaga:uarp-sdk` (Maven) | JVM 11+, Android 21+ |
| Ada | `packages/ada` | `uarp_sdk` (Alire) | GNAT 2022, libcurl |

Every SDK covers the **whole** API surface: 557 operations across 43 resource
groups, 575 models, 11 server-sent-event streams and the cursor-paginated
endpoints — plus the platform's auth, idempotency and retry semantics.

## What each SDK gives you

- **Typed models.** Every request and response body, including the ones the
  spec declares inline, is a named type in the target language.
- **Auth.** `Authorization: Bearer uarp_<prefix>_<secret>`, from an explicit key
  or from `UARP_API_KEY` / `SNAGA_API_KEY`.
- **Idempotency.** Every mutating `/api/v1/*` call sends an `Idempotency-Key`,
  which is also what makes a write safe to retry. You can supply your own key
  to replay a create deliberately.
- **Retries.** Transient failures (`408`, `409`, `429`, `5xx`, dropped
  connections) are retried with full-jitter exponential backoff, honouring
  `Retry-After` and the `X-Should-Retry: false` opt-out. Reads always retry;
  writes only when they carry an idempotency key.
- **Typed errors.** RFC 9457 problem documents are parsed into a structured
  error carrying the status, title, detail, `correlationId` and any field-level
  validation failures.
- **Streaming.** The 11 SSE endpoints return a native async stream — an
  `AsyncIterable`, a `futures::Stream`, an `AsyncSequence`, a `Flow`, or a
  dispatching sink in Ada — that reopens with `Last-Event-ID` when the
  connection ends. A connection that delivered at least one event earns a fresh
  reconnect budget, so a flapping server cannot spin the loop.
- **Pagination.** Cursor-paginated endpoints get an extra method that walks
  every page and yields items, stopping on `has_more: false`, a null cursor, an
  empty page, or a repeated cursor.
- **Forward compatibility.** An enum value the server adds tomorrow decodes
  into the existing type rather than failing.
- **Per-call overrides.** Timeout, retry budget, idempotency key and extra
  headers can be set for one call. Four SDKs take them as a trailing argument;
  Rust, which has no default arguments, takes them on a cheap clone of the
  client (`client.with_timeout(..).agents().get(id)`).

## Quick start

```ts
// TypeScript
import { UarpClient } from 'uarp-sdk';

const client = new UarpClient({ apiKey: process.env.UARP_API_KEY });
for await (const agent of client.agents.listAll({ limit: 50 })) {
  console.log(agent.name);
}
```

```rust
// Rust
let client = uarp_sdk::Client::from_env()?;
let page = client.agents().list(&Default::default()).await?;
```

```swift
// Swift
let client = try UARPClient.fromEnvironment()
let page = try await client.agents.list(limit: 50)
```

```kotlin
// Kotlin
val client = UarpClient.fromEnvironment()
val page = client.agents.list(limit = 50)
```

```ada
--  Ada
Client : constant UARP.Client.Client_Type := UARP.Client.From_Environment;
Page   : constant UARP.Models.List_Agents_Response :=
  UARP.API.Agents.List (Client);
```

Each package has its own README with installation, streaming, pagination, error
handling and the escape hatch for endpoints you would rather call by hand.

## Layout

```
spec/openapi.json          vendored API description (the single source of truth)
generator/                 OpenAPI -> IR -> five emitters
contract/                  one scenario, five SDKs, one comparison of the traffic
packages/typescript        uarp-sdk           (src/core hand-written, src/generated emitted)
packages/rust              uarp-sdk crate     (src/*.rs hand-written, src/generated emitted)
packages/swift             UARP SwiftPM       (Sources/UARP/Core, Sources/UARP/Generated)
packages/kotlin            ai.snaga:uarp-sdk  (ai/snaga/uarp, ai/snaga/uarp/generated)
packages/ada               uarp_sdk Alire     (src, src/generated)
scripts/generate.sh        regenerate every target
```

Inside each package the transport, error, retry, pagination and SSE layers are
hand-written and reviewed; only the model and operation surface is generated.
Generated files start with a `DO NOT EDIT` banner — change the emitter instead.

## Regenerating

```sh
make generate            # every target
make generate T=rust     # one target
make test                # build and test all five packages
```

or directly:

```sh
node generator/src/index.ts                 # all targets
node generator/src/index.ts typescript rust # a subset
node generator/src/index.ts --stats         # what the spec contains
```

The generator needs Node 22.6+ (it runs TypeScript sources directly) and has no
dependencies beyond the type checker.

To pick up a new version of the API, replace `spec/openapi.json` and rerun:

```sh
curl -s https://snaga.ai/openapi.json | python3 -m json.tool > spec/openapi.json
make generate && make test
```

## Proving the five agree

Unit tests check each SDK against its own idea of correct. The contract check
asks a different question: given the same logical call, do all five put the
same bytes on the wire?

```sh
make contract
```

It starts one server, runs the twelve-request scenario in
[contract/SCENARIOS.md](contract/SCENARIOS.md) through every SDK whose
toolchain is installed, records what each one sent, and fails if the traces
differ. Volatile values — the user agent, the idempotency key, the multipart
boundary — are masked; method, path, query, headers and body bytes are
compared exactly.

The last scenario asks the mirror-image question: given one awkward payload —
an enum value none of them has seen, an explicit `null`, an absent optional, an
empty array and an integer beyond 2^53 — do the five read the same values out
of it? Each runner reports what it decoded and those reports are compared too.

It has already earned its keep. It caught Kotlin sending
`application/json; charset=utf-8` where the others sent `application/json`, Ada
sending JSON null for an unset required `object` field where the others sent
`{}`, and Swift leaving `+` unescaped in a query value — which a form-decoding
server reads back as a space, silently changing the value.

Differences that cannot be fixed are recorded in
[contract/known-differences.json](contract/known-differences.json) with a
reason, and reported without failing the run.

## Releasing

All five packages share one version and one tag.

```sh
scripts/set-version.sh 0.3.0   # VERSION, every manifest, then regenerate
$EDITOR CHANGELOG.md
make test
git commit -am "Release 0.3.0" && git tag v0.3.0 && git push --follow-tags
```

The tag triggers `.github/workflows/release.yml`, which re-runs each package's
tests and then publishes: npm and crates.io directly, Maven Central through the
publisher API, and a GitHub release with the changelog entry. SwiftPM needs no
publishing step — the tag *is* the release — so that job just proves the tagged
commit builds. Alire submissions go through a pull request against the
community index, so the workflow prepares the tarball and leaves the rest to
you.

`workflow_dispatch` runs the same jobs with `dry_run` on: everything is built
and packed, nothing is uploaded.

## Design notes

**Naming.** Operation ids drive method names. `listAgents` inside the `Agents`
group becomes `list`, but only when the remainder is a single verb —
`listAgentRuns` keeps its full name rather than becoming a misleading
`listAgent`. Inline schemas are hoisted to `<OperationId>Request` /
`<OperationId>Response`, and nested objects take their parent's name as a
prefix, so a name always says where it came from.

**Strictness.** Fields the spec marks `required` are non-optional and decoding
fails if they are missing; everything else is optional. Unknown fields are
ignored, and unknown enum values are preserved rather than rejected.

**Endpoints documented without a response body** (115 of them) return raw JSON
rather than nothing, so a real payload is never silently discarded. Only `204`
really means "no content".

**`POST /api/v1/files`** accepts both `multipart/form-data` and JSON; the SDKs
use the JSON form, which is the one that carries `filename` and `mime_type`.
The two endpoints that are multipart-only (`registryPublish`,
`llmTranscribeAudio`) send real multipart bodies.

**Unions.** The three `oneOf` bodies in the spec are exposed as raw JSON in
Rust, Swift, Kotlin and Ada; TypeScript renders them as real union types.

**Unknown fields.** All five SDKs ignore response keys they do not model,
except on the two schemas that declare `additionalProperties`, where the extra
keys are kept and sent back unchanged.

## Licence

MIT. See [LICENSE](LICENSE).
