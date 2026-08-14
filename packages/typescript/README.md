# uarp-sdk

TypeScript/Node client for the **UARP — Universal Agent Runtime Platform** API.
Full coverage of all 557 endpoints, no runtime dependencies, ESM only.

```sh
npm install uarp-sdk
```

Requires Node 18+ (or any runtime with a global `fetch`).

The package is **ESM only**. `import` works everywhere; `require('uarp-sdk')`
needs Node 22.12+, where Node learned to require an ES module. On older Node a
CommonJS caller should use `await import('uarp-sdk')` instead. TypeScript sources
and declaration maps ship with the package, so go-to-definition lands in the
real source rather than a `.d.ts`.

## Quick start

```ts
import { UarpClient } from 'uarp-sdk';

const client = new UarpClient({ apiKey: process.env.UARP_API_KEY });

const agent = await client.agents.create({
  name: 'demo',
  model: { provider: 'openai_compat', model_ref: 'gpt-4o-mini', capabilities: {} },
});

const page = await client.agents.list({ limit: 20 });
console.log(page.items.length, page.has_more);
```

The API key falls back to `UARP_API_KEY`, then `SNAGA_API_KEY`. The base URL
falls back to `UARP_BASE_URL`, then production.

Resources hang off the client by tag: `client.agents`, `client.runs`,
`client.sessions`, `client.memory`, `client.teams`, … 43 in all. Editor
completion is the fastest way to browse them.

## Streaming

The 11 SSE endpoints return an `EventStream`, an async iterable that reconnects
with `Last-Event-ID` when a connection drops:

```ts
const stream = client.runs.streamRunEvents(runId);

for await (const event of stream) {
  if (event.event === 'llm.chunk') process.stdout.write(event.json<{ text: string }>().text);
  if (event.event === 'run.completed') break;   // leaving the loop closes the request
}

// Or wait for one specific event:
await client.runs.streamRunEvents(runId).until((e) => e.event === 'run.completed');
```

Browser proxies that cannot set an `Authorization` header can pass the key as a
query parameter with `new UarpClient({ sseTokenInQuery: true })`.

## Pagination

Cursor-paginated endpoints get a second method that walks every page:

```ts
for await (const agent of client.agents.listAll({ limit: 100 })) {
  console.log(agent.name);
}

// or collect with a cap
import { collect } from 'uarp-sdk';
const first500 = await collect(client.agents.listAll(), 500);
```

## Errors

Every non-2xx response throws a subclass of `APIError` carrying the parsed
RFC 9457 problem document:

```ts
import { APIError, RateLimitError, UnprocessableEntityError } from 'uarp-sdk';

try {
  await client.agents.get(id);
} catch (error) {
  if (error instanceof UnprocessableEntityError) {
    console.error(error.validationErrors);      // [{ field, message }]
  } else if (error instanceof RateLimitError) {
    console.error(error.retryAfterSeconds, error.remaining, error.reset);
  } else if (error instanceof APIError) {
    console.error(error.status, error.correlationId, error.problem.detail);
  }
}
```

`APIConnectionError` and `APITimeoutError` cover failures that never reached the
server.

## Configuration

```ts
const client = new UarpClient({
  apiKey: '...',
  baseURL: 'http://localhost:8080',
  timeout: 30_000,          // per request, ms
  maxRetries: 3,
  defaultHeaders: { 'X-Tenant': 'acme' },
  fetch: myInstrumentedFetch,
  userAgent: 'my-app/1.2.3',
});
```

Per-call overrides go in the last argument of any method:

```ts
await client.agents.create(body, {
  idempotencyKey: 'order-4711',   // replay the same create safely
  timeout: 5_000,
  maxRetries: 0,
  signal: controller.signal,
  headers: { 'X-Trace': traceId },
});
```

**Retries.** `408`, `409`, `429` and `5xx`, plus connection errors, are retried
with full-jitter backoff (500 ms → 8 s), honouring `Retry-After`. Reads always
retry; writes only when they carry an idempotency key — which every mutating
`/api/v1/*` call does automatically.

## Escape hatch

For an endpoint the generated surface does not fit:

```ts
const result = await client.request<{ ok: boolean }>({
  method: 'POST',
  path: '/api/v1/experimental/thing',
  body: { hello: 'world' },
  idempotent: true,
});
```

## Notes

- Fields the spec marks `required` are non-optional; everything else is
  optional. Unknown response fields are preserved on types that allow them.
- Enums are string-literal unions plus a `*_VALUES` array of the known values.
  A value the server adds later still parses — it just is not in the union.
- Dates are ISO-8601 strings, not `Date` objects.
- `client.files.create` uses the JSON body (base64 `data` plus `mime_type` and
  `filename`); the endpoint also accepts multipart if you need it via
  `client.request`.

## Development

```sh
npm install
npm run build        # tsc to dist/
npm test             # build, then node --test
npm run typecheck    # sources and examples
```

Files under `src/generated/` come from `generator/` in the repository root;
edit the emitter, not the output.
