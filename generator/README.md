# @uarp/codegen

Turns `spec/openapi.json` into five SDKs.

```sh
node src/index.ts                 # every target
node src/index.ts typescript rust # a subset
node src/index.ts --stats         # what the spec contains
node src/index.ts --check         # fail if the checked-in output is stale
```

`--check` is what CI runs: it compares the emitters' output against the files
on disk and names every one that is missing, stale or left over, rather than
diffing a working tree. It works locally too, with no commit needed.

Node 22.6+ runs the TypeScript sources directly; the only dependency is the
type checker (`npm install && npx tsc --noEmit`).

## How it is put together

```
src/parse.ts        OpenAPI 3.1  ->  IR
src/ir.ts           the IR every emitter consumes
src/naming.ts       casing rules and per-language reserved words
src/writer.ts       indentation-aware source writer
src/emit/*.ts       IR -> TypeScript, Rust, Swift, Kotlin, Ada
src/index.ts        CLI: wipes each target's generated directory, writes files
```

`parse.ts` is where every "what does the API look like" decision lives, so the
five emitters cannot disagree about nullability, naming or pagination. **No
emitter reads the raw OpenAPI document.**

## What the parser does

The UARP document declares most bodies inline rather than in
`components.schemas` (386 inline responses against 56 references), so the bulk
of the work is *hoisting*: each anonymous object or enum becomes a named IR type
whose name says where it came from.

- Request bodies become `<OperationId>Request`, responses
  `<OperationId>Response`, nested objects take their parent as a prefix.
- Enums are deduplicated by value set — the same set really is the same type.
  Objects are **not**: two unrelated `{ reason?: string }` bodies keep their own
  names, otherwise `agents.suspend()` would advertise a `SuspendTenantRequest`.
- `allOf` is flattened, `oneOf`/`anyOf` become IR unions, and the 3.1
  `type: ["string", "null"]` form sets nullability.
- Method names shorten only when it stays honest: `listAgents` in the `Agents`
  group becomes `list`, but `listAgentRuns` in `Runs` keeps its full name rather
  than collapsing to a misleading `listAgent`.
- Cursor pagination is detected from the `{ items, cursor, has_more }` envelope
  plus a `cursor` query parameter, and records whether each of those fields is
  optional so strongly-typed emitters can guard correctly.
- Endpoints documented without a response body return raw JSON, not `void`.
  Only `204`/`205`/`304` really mean "no content".

## Testing

```sh
npm test                    # unit, IR, golden and compile tests (~2 s)
npm run typecheck
npm run test:update-golden  # refresh golden files after an intended change
```

Four layers, cheapest first:

| Layer | File | What it protects |
| --- | --- | --- |
| Unit | `test/naming.test.ts` | casing, acronyms, singularisation, reserved words |
| IR | `test/parse.test.ts` | what the parser decides, on fixtures and on the real spec |
| Golden | `test/golden.test.ts` | the exact text every emitter produces |
| Compile | `test/compile.test.ts` | that the emitted TypeScript, Rust and Swift actually build |

`test/fixtures/*.json` are minimal OpenAPI documents, one per decision the
parser makes: nullability, enums (including a literal `"other"` that collides
with the catch-all variant), pagination envelopes, method-name shortening,
names that shadow the standard library, `allOf`/`oneOf`, body encodings, and
event streams. They are small on purpose — a golden diff has to be readable.

Golden files record whatever the emitters produce, including code that would
not compile, which is why `compile.test.ts` exists: it emits every fixture next
to a copy of the hand-written core and compiles the lot in one pass — `tsc` for
TypeScript, `cargo check` over a throwaway workspace for Rust, `swift build`
over a package of eight modules for Swift. Each check skips itself when its
toolchain is missing, and `UARP_COMPILE_TARGETS=swift` narrows the run to one
language; CI uses that to check Swift on the macOS runner it already pays for.

Kotlin and Ada are covered by the production spec, which their package builds
compile in CI. Gradle and GNAT are slow enough that a per-fixture build would
cost more than it catches, and the golden files already show what those two
emitters produce for the edge cases.

### Fixing a bug at generator level

1. Reproduce it small. Add or extend a fixture, then look at the output
   directly:

   ```sh
   node src/index.ts --spec test/fixtures/enums.json --out /tmp/probe typescript
   ```

2. Decide whether it is a parser bug or an emitter bug. **If you find yourself
   deducing something about the API inside an emitter, it belongs in the IR.**
   A wrong shape in one language is an emitter bug; wrong nullability, a wrong
   type or missing pagination is a parser bug and affects all five.

3. Fix, then `npm test`. A golden diff tells you exactly which languages
   changed and how; `npm run test:update-golden` accepts it once you have read
   it.

4. Finish with `make test` from the repository root — the five real SDKs
   compiling against the full spec is the last line of defence, and each
   language catches a different class of mistake.

## Adding a language

1. Write `src/emit/<lang>.ts` exporting `emit<Lang>(spec: Spec): GeneratedFile[]`
   with paths relative to the package root.
2. Register it in the `TARGETS` table in `src/index.ts`, naming the directory
   that gets wiped before each run.
3. Hand-write the runtime (transport, retries, errors, SSE, pagination) in that
   package. Only models and operations should be generated.
4. Run `npm run test:update-golden` to record the new target's fixture output,
   and read every one of the eight diffs before committing them.

The generated directory is deleted on every run, so a renamed type never leaves
a stale file behind.

## Conventions worth knowing

- Every emitted file starts with a `DO NOT EDIT` banner.
- Doc comments are escaped per language: Rust escapes `[` (intra-doc links),
  Kotlin escapes both `/*` and `*/` (its block comments nest), TypeScript
  escapes `*/`, and Ada folds non-ASCII to ASCII because GNAT reads Latin-1.
- Names that would shadow the standard library are suffixed — the spec really
  does define a schema called `Error`, which would break `throws` in Swift.
- Reserved words are escaped per language (`r#type`, `` `object` ``, `Type_K`).
- An emitter that meets a body encoding it cannot render stops the build.
  Only TypeScript implements `application/x-www-form-urlencoded`; the other
  four would otherwise fall back to JSON and put the wrong content type on the
  wire. No endpoint in this spec uses it yet — the guard is there for the day
  one does.
