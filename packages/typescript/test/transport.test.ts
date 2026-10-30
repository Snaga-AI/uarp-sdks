import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseRetryAfter } from '../dist/core/util.js';
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  NotFoundError,
  RateLimitError,
  UarpClient,
  UnprocessableEntityError,
} from '../dist/index.js';

interface Call {
  url: string;
  init: RequestInit;
}

/** Build a client whose fetch replays the given responses in order. */
function clientWith(responses: Array<Response | (() => Response | Promise<Response>)>, options = {}) {
  const calls: Call[] = [];
  let index = 0;
  const client = new UarpClient({
    apiKey: 'uarp_test1234_secret',
    baseURL: 'https://api.example.test',
    maxRetries: 0,
    ...options,
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const entry = responses[Math.min(index++, responses.length - 1)];
      return typeof entry === 'function' ? entry() : entry!;
    },
  });
  return { client, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function problem(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

test('sends bearer auth, user agent and json accept headers', async () => {
  const { client, calls } = clientWith([json({ items: [], cursor: null, has_more: false })]);
  await client.agents.list();

  assert.equal(calls.length, 1);
  const headers = new Headers(calls[0]!.init.headers);
  assert.equal(headers.get('authorization'), 'Bearer uarp_test1234_secret');
  assert.equal(headers.get('accept'), 'application/json');
  assert.match(headers.get('user-agent') ?? '', /^uarp-sdk-typescript\//);
});

test('serialises path and query parameters', async () => {
  const { client, calls } = clientWith([json({ items: [], cursor: null, has_more: false })]);
  await client.agents.list({ limit: 25, cursor: 'abc def', include_offline: true });

  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, '/api/v1/agents');
  assert.equal(url.searchParams.get('limit'), '25');
  assert.equal(url.searchParams.get('cursor'), 'abc def');
  assert.equal(url.searchParams.get('include_offline'), 'true');
});

test('omits undefined query parameters entirely', async () => {
  const { client, calls } = clientWith([json({ items: [], cursor: null, has_more: false })]);
  await client.agents.list({ limit: undefined, cursor: 'x' });

  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.has('limit'), false);
  assert.equal(url.searchParams.get('cursor'), 'x');
});

test('percent-encodes path parameters', async () => {
  const { client, calls } = clientWith([json({})]);
  await client.agents.get('id with/slash');

  assert.ok(calls[0]!.url.endsWith('/api/v1/agents/id%20with%2Fslash'), calls[0]!.url);
});

test('attaches an Idempotency-Key to mutating requests only', async () => {
  const { client, calls } = clientWith([json({}), json({ items: [], cursor: null })]);
  await client.agents.create({ name: 'demo' } as never);
  await client.agents.list();

  assert.ok(new Headers(calls[0]!.init.headers).get('idempotency-key'));
  assert.equal(new Headers(calls[1]!.init.headers).get('idempotency-key'), null);
});

test('reuses a caller-supplied idempotency key', async () => {
  const { client, calls } = clientWith([json({})]);
  await client.agents.create({ name: 'demo' } as never, { idempotencyKey: 'fixed-key' });

  assert.equal(new Headers(calls[0]!.init.headers).get('idempotency-key'), 'fixed-key');
});

test('keeps the same idempotency key across retries', async () => {
  const { client, calls } = clientWith(
    [problem(500, { title: 'boom' }, { 'retry-after': '0' }), json({ ok: true })],
    { maxRetries: 1 },
  );
  await client.agents.create({ name: 'demo' } as never);

  assert.equal(calls.length, 2);
  const first = new Headers(calls[0]!.init.headers).get('idempotency-key');
  const second = new Headers(calls[1]!.init.headers).get('idempotency-key');
  assert.ok(first);
  assert.equal(first, second);
});

test('retries 429 responses and honours Retry-After', async () => {
  const { client, calls } = clientWith(
    [problem(429, { title: 'Too Many Requests' }, { 'retry-after': '0' }), json({ agent_id: 'a1' })],
    { maxRetries: 2 },
  );
  const agent = await client.agents.get('a1');

  assert.equal(calls.length, 2);
  assert.deepEqual(agent, { agent_id: 'a1' });
});

test('gives up after maxRetries and throws a typed rate-limit error', async () => {
  const { client, calls } = clientWith(
    [problem(429, { title: 'slow down', status: 429 }, { 'retry-after': '0', 'x-ratelimit-limit': '100' })],
    { maxRetries: 1 },
  );

  await assert.rejects(
    () => client.agents.get('a1'),
    (error: unknown) => {
      assert.ok(error instanceof RateLimitError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 0);
      assert.equal(error.limit, 100);
      return true;
    },
  );
  assert.equal(calls.length, 2);
});

test('does not retry a 404', async () => {
  const { client, calls } = clientWith([problem(404, { title: 'Not Found', detail: 'no such agent' })], {
    maxRetries: 3,
  });

  await assert.rejects(
    () => client.agents.get('missing'),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundError);
      assert.match(error.message, /Not Found/);
      assert.match(error.message, /no such agent/);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test('exposes field-level validation errors from 422 responses', async () => {
  const { client } = clientWith([
    problem(422, {
      title: 'Unprocessable Entity',
      status: 422,
      correlationId: 'corr-1',
      errors: [{ field: 'name', message: 'required' }],
    }),
  ]);

  await assert.rejects(
    () => client.agents.create({} as never),
    (error: unknown) => {
      assert.ok(error instanceof UnprocessableEntityError);
      assert.equal(error.correlationId, 'corr-1');
      assert.deepEqual(error.validationErrors, [{ field: 'name', message: 'required' }]);
      return true;
    },
  );
});

test('surfaces a timeout as APITimeoutError', async () => {
  const client = new UarpClient({
    apiKey: 'k',
    baseURL: 'https://api.example.test',
    timeout: 20,
    maxRetries: 0,
    fetch: (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      }),
  });

  await assert.rejects(() => client.agents.get('a1'), APITimeoutError);
});

test('propagates caller aborts without retrying', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const client = new UarpClient({
    apiKey: 'k',
    baseURL: 'https://api.example.test',
    maxRetries: 5,
    fetch: (_url: string, init: RequestInit) => {
      attempts++;
      controller.abort();
      return new Promise<Response>((_resolve, reject) => {
        // Mirror what a real fetch does: reject straight away if already aborted.
        if (init.signal?.aborted) {
          reject(init.signal.reason ?? new Error('aborted'));
          return;
        }
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  });

  await assert.rejects(() => client.agents.get('a1', { signal: controller.signal }));
  assert.equal(attempts, 1);
});

test('sends a JSON body with the right content type', async () => {
  const { client, calls } = clientWith([json({})]);
  await client.agents.create({ name: 'demo', model: { provider: 'anthropic' } } as never);

  const headers = new Headers(calls[0]!.init.headers);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), {
    name: 'demo',
    model: { provider: 'anthropic' },
  });
});

test('builds a multipart body for uploads', async () => {
  const { client, calls } = clientWith([json({ name: 'demo' }, 201)]);

  await client.registry.registryPublish({
    manifest: '{"name":"demo"}',
    artifact: new Uint8Array([0, 255, 65]),
    sha256: 'abc123',
  });

  const body = calls[0]!.init.body;
  assert.ok(body instanceof FormData);
  assert.equal(body.get('manifest'), '{"name":"demo"}');
  assert.equal(body.get('sha256'), 'abc123');
  // An optional part the caller left out must not appear at all.
  assert.equal(body.has('attestation'), false);

  const file = body.get('artifact');
  assert.ok(file instanceof Blob);
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [0, 255, 65]);

  // fetch has to pick the boundary, so the SDK must not set Content-Type.
  assert.equal(new Headers(calls[0]!.init.headers).get('content-type'), null);
});

test('accepts a named file part', async () => {
  const { client, calls } = clientWith([json({}, 201)]);

  await client.registry.registryPublish({
    manifest: '{}',
    artifact: { data: new Uint8Array([1, 2]), filename: 'bundle.tar.zst', contentType: 'application/zstd' },
  });

  const file = (calls[0]!.init.body as FormData).get('artifact');
  assert.ok(file instanceof File);
  assert.equal(file.name, 'bundle.tar.zst');
  assert.equal(file.type, 'application/zstd');
});

test('the generated form operation sends the WHATWG form bytes, fields in schema order', async () => {
  // Sign in with Apple posts its callback form-encoded. The bytes are the
  // contract (SCENARIOS.md, scenario 20): schema order whatever order the
  // caller wrote, absent fields left out, space as `+`, `~` and every other
  // byte outside `A-Z a-z 0-9 * - . _` as upper-case %XX.
  const { client, calls } = clientWith([json({ api_key: 'k', email: 'a@b.c' })]);

  const answer = await client.auth.completeOAuthLoginFormPost('apple', {
    user: '{"name":"А Б","email":"a@b.c"}',
    id_token: undefined,
    state: 's/ы&=~*',
    code: 'c 1+2',
  });

  // What fetch itself puts on the wire, not the object handed to it.
  const sent = new Request(calls[0]!.url, calls[0]!.init);
  assert.equal(sent.method, 'POST');
  assert.equal(new URL(sent.url).pathname, '/api/v1/auth/oauth/apple/callback');
  assert.equal(sent.headers.get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(
    await sent.text(),
    'code=c+1%2B2&state=s%2F%D1%8B%26%3D%7E*&user=%7B%22name%22%3A%22%D0%90+%D0%91%22%2C%22email%22%3A%22a%40b.c%22%7D',
  );
  assert.equal(answer.email, 'a@b.c');
});

test('returns undefined for 204 responses', async () => {
  const { client } = clientWith([new Response(null, { status: 204 })]);
  const result = await client.files.delete('f1');
  assert.equal(result, undefined);
});

test('does not retry a conflict, even on a write that carries a key', async () => {
  // A conflict is the server's answer about the resource's state; the same
  // request meets the same state. It used to be sent four times here.
  const { client, calls } = clientWith(
    [problem(409, { title: 'Conflict', code: 'CLIENT_REQUEST_CONFLICT' }, { 'retry-after': '0' })],
    { maxRetries: 3 },
  );

  await assert.rejects(
    () => client.agents.create({ name: 'demo' }),
    (error: unknown) => error instanceof APIError && error.status === 409,
  );
  assert.equal(calls.length, 1);
  assert.ok(new Headers(calls[0]?.init.headers).get('idempotency-key'));
});

test('an image upload sends raw bytes under an image type', async () => {
  // It went out as JSON, which the server refuses with 415.
  const { client, calls } = clientWith([json({ file_id: 'f1', mime_type: 'image/png', size: 4 }, 201), json({ file_id: 'f2', mime_type: 'image/png', size: 4 }, 201)]);
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  await client.public.uploadPublicSessionImage('s1', bytes);
  await client.public.uploadPublicSessionImage('s1', new Blob([bytes], { type: 'image/png' }));

  const [bare, typed] = calls;
  assert.equal(new Headers(bare!.init.headers).get('content-type'), 'image/*');
  assert.deepEqual(new Uint8Array(await new Response(bare!.init.body as BodyInit).arrayBuffer()), bytes);
  assert.equal(new Headers(typed!.init.headers).get('content-type'), 'image/png');
});

test('does not retry a write that carries no idempotency key', async () => {
  const { client, calls } = clientWith(
    [problem(500, { title: 'boom' }, { 'retry-after': '0' })],
    { maxRetries: 3 },
  );

  // Outside /api/v1 the transport adds no key, so replaying the write would
  // risk performing it twice.
  await assert.rejects(
    () => client.request({ method: 'POST', path: '/experimental/thing', body: {} }),
    APIError,
  );
  assert.equal(calls.length, 1);
});

test('encodes a form body when one is asked for', async () => {
  // The escape hatch offers form encoding for any endpoint, so it has to be
  // right there too, not only in the generated form operation.
  const { client, calls } = clientWith([json({ ok: true })]);

  await client.request({
    method: 'POST',
    path: '/api/v1/experimental/form',
    form: { username: 'ada', password: 'p@ss word', tags: undefined, meta: { a: 1 } },
  });

  const headers = new Headers(calls[0]!.init.headers);
  assert.equal(headers.get('content-type'), 'application/x-www-form-urlencoded');

  const body = calls[0]!.init.body;
  assert.ok(body instanceof URLSearchParams);
  assert.equal(body.get('username'), 'ada');
  assert.equal(body.get('password'), 'p@ss word');
  // Undefined fields are dropped, objects are JSON-encoded.
  assert.equal(body.has('tags'), false);
  assert.equal(body.get('meta'), '{"a":1}');
});

test('downloads bytes verbatim', async () => {
  const payload = new Uint8Array([0, 255, 65, 0, 66]);
  const { client } = clientWith([
    new Response(payload, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
  ]);

  const blob = await client.files.downloadFileContent('f1');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [...payload]);
});

test('per-request options override client defaults', async () => {
  const { client, calls } = clientWith([json({})]);
  await client.agents.get('a1', {
    baseURL: 'https://other.example.test',
    headers: { 'X-Trace': 'abc' },
    query: { debug: '1' },
  });

  assert.ok(calls[0]!.url.startsWith('https://other.example.test/'), calls[0]!.url);
  assert.equal(new Headers(calls[0]!.init.headers).get('x-trace'), 'abc');
  assert.equal(new URL(calls[0]!.url).searchParams.get('debug'), '1');
});

test('does not retry when the server says not to', async () => {
  const { client, calls } = clientWith(
    [problem(500, { title: 'boom' }, { 'x-should-retry': 'false', 'retry-after': '0' })],
    { maxRetries: 3 },
  );

  await assert.rejects(() => client.agents.get('a1'), APIError);
  assert.equal(calls.length, 1, 'X-Should-Retry: false must win over the status');
});

test('retries a connection failure and succeeds', async () => {
  let attempts = 0;
  const client = new UarpClient({
    apiKey: 'k',
    baseURL: 'https://api.example.test',
    maxRetries: 2,
    fetch: async () => {
      attempts++;
      if (attempts === 1) throw new TypeError('network down');
      return json({ agent_id: 'a1' });
    },
  });

  const agent = await client.agents.get('a1');
  assert.equal(agent.agent_id, 'a1');
  assert.equal(attempts, 2);
});

test('gives up on a connection failure once the budget is spent', async () => {
  let attempts = 0;
  const client = new UarpClient({
    apiKey: 'k',
    baseURL: 'https://api.example.test',
    maxRetries: 1,
    fetch: async () => {
      attempts++;
      throw new TypeError('network down');
    },
  });

  await assert.rejects(() => client.agents.get('a1'), APIConnectionError);
  assert.equal(attempts, 2);
});

test('reads Retry-After in both of its forms', () => {
  const seconds = new Headers({ 'retry-after': '2.5' });
  assert.equal(parseRetryAfter(seconds), 2500);

  // The HTTP-date form is relative to now, so pin the clock.
  const now = Date.parse('2026-01-01T00:00:00Z');
  const date = new Headers({ 'retry-after': 'Thu, 01 Jan 2026 00:00:30 GMT' });
  assert.equal(parseRetryAfter(date, now), 30_000);

  // A date in the past means "now", not a negative wait.
  const past = new Headers({ 'retry-after': 'Wed, 31 Dec 2025 23:59:00 GMT' });
  assert.equal(parseRetryAfter(past, now), 0);

  assert.equal(parseRetryAfter(new Headers()), undefined);
  assert.equal(parseRetryAfter(new Headers({ 'retry-after': 'nonsense' })), undefined);
});

test('throws a helpful error when no API key is configured', () => {
  const previous = process.env.UARP_API_KEY;
  const previousSnaga = process.env.SNAGA_API_KEY;
  delete process.env.UARP_API_KEY;
  delete process.env.SNAGA_API_KEY;
  try {
    assert.throws(() => new UarpClient(), /Missing API key/);
  } finally {
    if (previous !== undefined) process.env.UARP_API_KEY = previous;
    if (previousSnaga !== undefined) process.env.SNAGA_API_KEY = previousSnaga;
  }
});

/**
 * A client whose credentials travel another way.
 *
 * The browser app is authenticated by an HttpOnly cookie: it never sees a key,
 * so it could not construct a client at all — the constructor threw. And had it
 * passed an empty string, the transport would have sent `Authorization: Bearer `
 * with nothing after it, which is NOT the same as sending no header: a server
 * that validates the value can refuse it, and it overrides the cookie the
 * browser would otherwise attach.
 *
 * The distinction being pinned here is omitted-vs-empty. Omitted stays an error,
 * because "forgot to set UARP_API_KEY" is the common mistake and a 401 is a
 * much worse way to learn about it.
 */
test('an explicitly empty apiKey sends no Authorization header', async () => {
  const { client, calls } = clientWith([json({ ok: true })], { apiKey: '' });
  await client.transport.request({ method: 'GET', path: '/api/v1/me' });
  const headers = new Headers(calls[0]!.init.headers as HeadersInit);
  assert.equal(headers.get('Authorization'), null);
});

test('a real apiKey is still sent — the guard must not silence every client', async () => {
  const { client, calls } = clientWith([json({ ok: true })]);
  await client.transport.request({ method: 'GET', path: '/api/v1/me' });
  const headers = new Headers(calls[0]!.init.headers as HeadersInit);
  assert.equal(headers.get('Authorization'), 'Bearer uarp_test1234_secret');
});

test('an omitted apiKey still throws, and says what to pass instead', () => {
  assert.throws(
    () => new UarpClient({ baseURL: 'https://api.example.test', fetch: async () => json({}) }),
    (err: Error) => /Missing API key/.test(err.message) && /apiKey: ""/.test(err.message),
  );
});

/**
 * A failure the server did not phrase as RFC 9457 must still reach the caller.
 *
 * 32 handlers answer with a bare `{"error": "..."}`. Before this, `readProblem`
 * cast any JSON object to a problem document, so those arrived with no title
 * and no detail and `formatMessage` rendered `403 HTTP 403` — the reason was
 * discarded inside the SDK, before any application code could show it. The
 * raw-text fallback existed but a cast cannot throw, so it was unreachable for
 * precisely these inputs.
 */
test('a bare {"error"} body keeps its message', async () => {
  const { client } = clientWith([problem(403, { error: 'Insufficient role: owner required' })]);
  await assert.rejects(
    () => client.request({ method: 'GET', path: '/api/v1/mcp/servers' }),
    (err: APIError) => {
      assert.equal(err.problem.detail, 'Insufficient role: owner required');
      assert.match(err.message, /Insufficient role/);
      return true;
    },
  );
});

test('a nested {"error": {"message"}} body keeps its message', async () => {
  const { client } = clientWith([problem(502, { error: { message: 'Upstream error' } })]);
  await assert.rejects(
    () => client.request({ method: 'GET', path: '/api/v1/llm/chat' }),
    (err: APIError) => {
      assert.equal(err.problem.detail, 'Upstream error');
      return true;
    },
  );
});

test('a real problem document is still used as-is', async () => {
  const { client } = clientWith([
    problem(404, { type: 'about:blank', title: 'Not Found', status: 404, detail: 'no such agent' }),
  ]);
  await assert.rejects(
    () => client.request({ method: 'GET', path: '/api/v1/agents/x' }),
    (err: APIError) => {
      assert.equal(err.problem.title, 'Not Found');
      assert.equal(err.problem.detail, 'no such agent');
      return true;
    },
  );
});

test('a non-JSON error body is not thrown away either', async () => {
  const { client } = clientWith([
    new Response('<html><body>502 Bad Gateway</body></html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }),
  ]);
  await assert.rejects(
    () => client.request({ method: 'GET', path: '/api/v1/agents' }),
    (err: APIError) => {
      assert.match(err.problem.detail ?? '', /Bad Gateway/);
      return true;
    },
  );
});

// Real bytes: the 401 production answered on 2026-10-15 with no key and our own
// `X-Request-Id`; the 501 `GET /registry/keys` gave the canon tenant the day
// before. The 501's code is not in the `ErrorCode` enum and it carries only the
// deprecated `correlationId`.
const LIVE_401 =
  '{"type":"about:blank","title":"Unauthorized","status":401,"detail":"Missing Authorization header, token query parameter, or uarp_session cookie","correlationId":"sdk-probe-0001","correlation_id":"sdk-probe-0001","code":"AUTH_ERROR"}';
const CANON_501 =
  '{"type": "about:blank", "title": "Not Implemented", "status": 501, "detail": "Artifact signing is disabled (spec_registry.signing_mode = \\"off\\").", "code": "SIGNING_NOT_CONFIGURED", "correlationId": "01a13c8d-1f16-732c-8884-727d6fb7bcdb"}';

function raw(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/problem+json', ...headers } });
}

async function apiErrorFor(response: Response): Promise<APIError> {
  const { client } = clientWith([response]);
  try {
    await client.agents.get('a1');
  } catch (error) {
    assert.ok(error instanceof APIError);
    return error;
  }
  throw new Error('must fail');
}

test('a problem keeps its code and request id', async () => {
  const error = await apiErrorFor(raw(401, LIVE_401, { 'x-request-id': 'sdk-probe-0001' }));
  assert.equal(error.code, 'AUTH_ERROR');
  assert.equal(error.correlationId, 'sdk-probe-0001');
});

test('a code the enum does not list still reaches the caller', async () => {
  const error = await apiErrorFor(raw(501, CANON_501));
  assert.equal(error.code, 'SIGNING_NOT_CONFIGURED');
  assert.equal(error.correlationId, '01a13c8d-1f16-732c-8884-727d6fb7bcdb');
});

test('the request id header is the fallback', async () => {
  const body = '{"type":"about:blank","title":"Not Found","status":404,"detail":"no such agent"}';
  const error = await apiErrorFor(raw(404, body, { 'x-request-id': 'req-42' }));
  assert.equal(error.correlationId, 'req-42');
});

// Real bytes: the 422 the session route answers for a closed session, captured by the API lane from handleRequest on the code deployed as b108e9a9 (2026-10-15).
// `session_status` is a top-level extension member, as RFC 9457 puts them.
const SESSION_NOT_ACTIVE_422 =
  '{"type":"about:blank","title":"Validation Error","status":422,"detail":"Session is not active","correlationId":"01a13f4a-fb5a-7d99-9d94-910550f34d83","correlation_id":"01a13f4a-fb5a-7d99-9d94-910550f34d83","code":"SESSION_NOT_ACTIVE","session_status":"closed"}';

test('an extension member reaches the caller beside the code', async () => {
  const error = await apiErrorFor(raw(422, SESSION_NOT_ACTIVE_422));
  assert.equal(error.code, 'SESSION_NOT_ACTIVE');
  assert.equal(error.problem.session_status, 'closed');
  assert.equal(error.correlationId, '01a13f4a-fb5a-7d99-9d94-910550f34d83');
});

// Real bytes: the 403 a refused X-Active-Tenant answers on production, build e0b37b03 (2026-10-17). membership_suspended is the API lane's capture from handleRequest at d6b1c66e5, the same code: producing it on the wire would mean suspending a membership on canon.
const NOT_A_MEMBER_403 =
  '{"type":"about:blank","title":"Forbidden","status":403,"detail":"You are not a member of the active tenant requested by X-Active-Tenant","correlationId":"01a14b59-dd54-7a2f-aa6b-e4338e105419","correlation_id":"01a14b59-dd54-7a2f-aa6b-e4338e105419","code":"FORBIDDEN","reason":"not_a_member"}';
const MEMBERSHIP_SUSPENDED_403 =
  '{"type":"about:blank","title":"Forbidden","status":403,"detail":"Your membership in the active tenant requested by X-Active-Tenant is suspended","correlationId":"01a14a66-dcfc-7a98-9221-f40af5b6cd0b","correlation_id":"01a14a66-dcfc-7a98-9221-f40af5b6cd0b","code":"FORBIDDEN","reason":"membership_suspended"}';
// Real bytes: the same refusal on production, build d926b90e (2026-10-17), before batch19: no code and no reason.
const NOT_A_MEMBER_403_D926 =
  '{"type":"about:blank","title":"Forbidden","status":403,"detail":"You are not a member of the active tenant requested by X-Active-Tenant","correlationId":"01a14a66-337b-7324-9a2a-9354a8fc02c6","correlation_id":"01a14a66-337b-7324-9a2a-9354a8fc02c6"}';

test('the reason a tenant refused the caller reaches it, typed', async () => {
  const notAMember = await apiErrorFor(raw(403, NOT_A_MEMBER_403));
  assert.equal(notAMember.code, 'FORBIDDEN');
  assert.equal(notAMember.reason, 'not_a_member');
  const suspended = await apiErrorFor(raw(403, MEMBERSHIP_SUSPENDED_403));
  assert.equal(suspended.reason, 'membership_suspended');
  const before = await apiErrorFor(raw(403, NOT_A_MEMBER_403_D926));
  assert.equal(before.reason, undefined);
  assert.equal(before.code, undefined);
});

// Real bytes: the 4-byte body `null` that GET /agents/{id}/schedule answered
// the canon tenant on 2026-10-15 (build b108e9a9) for an agent with no schedule.
// The method is typed `Schedule | null`; this proves the runtime agrees.
test('a schedule that is not set is null', async () => {
  const { client } = clientWith([new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })]);
  const schedule: unknown = await client.scheduler.getSchedule('a1');
  assert.equal(schedule, null);
});
