# Live conformance probe

Calls the whole documented surface against a running server, checks every
response against the schema that promised it, and writes a report for whoever
owns the API.

This is the layer the other tests cannot reach. The generator's golden tests
prove the emitters are stable, and `contract/` proves the five SDKs put
identical bytes on the wire — but both compare the SDKs against the *document*.
Only this probe asks whether the document tells the truth.

## Running it

```sh
node smoke/src/run.ts --dry-run          # what would be called, in what order
UARP_API_KEY=… node smoke/src/run.ts     # the sweep
node smoke/src/report.ts                 # smoke/out/BACKEND-REPORT.md
node smoke/src/html.ts                   # smoke/out/backend-report.html
```

or `make smoke`, which does the sweep and both reports. The Markdown is for
reading; the page is for working from — severity encoded in form, the serious
findings above the fold, the cosmetic ones collapsed.

Useful flags: `--base-url` to aim elsewhere (default `https://api.snaga.ai`),
`--only <substring>` to restrict to matching routes, `--limit N` to stop early,
`--delay <ms>` to be gentler, `--allow <operationId>` to release one quarantined
call, `--include-quarantined` to release all of them.

The key is read from `UARP_API_KEY` and never written anywhere: the results file
is scanned for it before it is saved, and the write is refused if it is present.
`smoke/out/` is not tracked.

## How a request is built

Every payload is **the documented minimum** — each property the schema marks
required, and nothing else. This is the point of the exercise. If the server
then rejects the call, either it enforces a rule the schema never states, or the
schema marks something optional that is not. Both are findings, and filling in
every optional property as well would hide them.

Two exceptions:

- **`PUT` with a matching `GET`** sends back what the read just returned,
  unchanged. Configuration endpoints are exercised without being altered, and a
  server that refuses its own output has a read/write asymmetry worth knowing
  about.
- **Path parameters** prefer an id created earlier in the same run. Where none
  exists the probe invents one and expects a 404; that still exercises the
  route, the authorisation check and the error shape, and the result is marked
  so the 404 is not read as a fault.

## Order, and why deletes are safe

Calls run in phases: public reads, collection reads, creates, item reads,
updates, deletes. Creates capture the identifiers they return, keyed by the
collection that produced them — `{id}` means something different under
`/companies` than under `/integrations`, and a delete aimed at the wrong one
would destroy real data. Deletes run last, deepest path first, and only ever
against identifiers this run created.

Everything created is named `smoke-<runId>`, so anything left behind is
identifiable. The report lists it.

## What is held back

`quarantine.json` names the calls the probe will not make on its own: those that
delete the tenant, revoke the credential the run is using, or change state for
every tenant on the platform. Running them would end the run and could not be
undone. They are listed in the report as held back, with the reason, so the
decision stays with a person. `--allow` releases one.

A second list marks calls that reach outside the platform — sending mail,
creating a payment session, publishing publicly, spending model tokens. Those
*do* run; the report simply calls them out.

## What the probe checks

Against the schema for whichever status actually came back:

| | |
|---|---|
| `missing-required` | the server omits a property the document requires — strict decoders throw |
| `type-mismatch`, `null-not-allowed` | the value cannot be decoded into the generated type |
| `no-variant-matched` | nothing in a `oneOf`/`anyOf` accepts what arrived |
| `unknown-enum`, `const-mismatch` | the document's fixed values are out of date |
| `undocumented-property` | the server sends data no generated model exposes |
| `precision-loss` | an integer past 2^53, which JavaScript and Ada silently corrupt |

And around the call itself: statuses the document never mentions, error bodies
that are not RFC 9457, 5xx faults, authorisation that disagrees with the
declared scopes, and response times worth investigating.

Severities are written from the SDKs' point of view, not JSON Schema's. A
`missing-required` is major because Rust, Swift and Kotlin throw on it; an
unknown enum value is minor because every generated enum carries a catch-all.

## Requests go through the SDK

Each call is made by the TypeScript SDK's own `Transport`, so the run exercises
shipped code — its encoders, retry policy and error mapping — rather than a
separate HTTP client written for testing. A recording `fetch` underneath keeps
the raw bytes the transport has already parsed away, which is how large-integer
corruption is detected at all.

Long-lived endpoints — SSE, WebSocket upgrades, long polls — are not part of a
request/response sweep. They belong to the per-language smoke runners, which
know when to stop reading.
