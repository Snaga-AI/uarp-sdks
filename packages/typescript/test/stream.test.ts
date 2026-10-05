import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import {
  APIConnectionError,
  APIError,
  autoPaginate,
  collect,
  parseEventStream,
  RateLimitError,
  UarpClient,
  type UarpEvent,
} from '../dist/index.js';

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function drain(chunks: string[]): Promise<UarpEvent[]> {
  const out: UarpEvent[] = [];
  for await (const event of parseEventStream(bodyOf(chunks))) out.push(event);
  return out;
}

test('parses simple sse frames', async () => {
  const events = await drain(['event: run.started\ndata: {"run_id":"r1"}\n\n']);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event, 'run.started');
  assert.deepEqual(events[0]!.json(), { run_id: 'r1' });
});

test('defaults the event name to message and joins multi-line data', async () => {
  const events = await drain(['data: line one\ndata: line two\n\n']);
  assert.equal(events[0]!.event, 'message');
  assert.equal(events[0]!.data, 'line one\nline two');
});

test('ignores comments and unknown fields', async () => {
  const events = await drain([': keep-alive\nfoo: bar\ndata: hello\n\n']);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.data, 'hello');
});

test('handles frames split across chunk boundaries', async () => {
  const events = await drain(['event: par', 'tial\ndata: {"a":', '1}\n', '\n']);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event, 'partial');
  assert.deepEqual(events[0]!.json(), { a: 1 });
});

test('handles CRLF split across chunk boundaries', async () => {
  const events = await drain(['data: one\r', '\ndata: two\r\n\r\n']);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.data, 'one\ntwo');
});

test('carries the id field', async () => {
  const events = await drain(['id: 42\ndata: x\n\n']);
  assert.equal(events[0]!.id, '42');
});

test('streams run events through the client and resumes with Last-Event-ID', async () => {
  const seen: Array<Record<string, string | null>> = [];
  let call = 0;
  const client = new UarpClient({
    apiKey: 'k',
    baseURL: 'https://api.example.test',
    fetch: async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      seen.push({ url, lastEventId: headers.get('last-event-id'), accept: headers.get('accept') });
      const chunks =
        call++ === 0
          ? ['id: 1\nevent: llm.chunk\ndata: {"text":"he"}\n\n']
          : ['id: 2\nevent: run.completed\ndata: {}\n\n'];
      return new Response(bodyOf(chunks), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });

  const stream = client.runs.streamRunEvents('r1');
  const events: UarpEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    if (event.event === 'run.completed') break;
  }

  assert.deepEqual(
    events.map((e) => e.event),
    ['llm.chunk', 'run.completed'],
  );
  assert.equal(seen[0]!.accept, 'text/event-stream');
  assert.equal(seen[0]!.lastEventId, null);
  // The stream ended cleanly, so the reconnect replays from the last id it saw.
  assert.equal(seen[1]!.lastEventId, '1');
  assert.equal(stream.closed, true);
});

test('until() resolves on the first matching event and closes the stream', async () => {
  const client = new UarpClient({
    apiKey: 'k',
    baseURL: 'https://api.example.test',
    fetch: async () =>
      new Response(bodyOf(['event: a\ndata: 1\n\n', 'event: done\ndata: 2\n\n']), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
  });

  const stream = client.runs.streamRunEvents('r1');
  const event = await stream.until((e) => e.event === 'done');
  assert.equal(event?.data, '2');
  assert.equal(stream.closed, true);
});

test('sends the key as a query parameter when the transport is told to', async () => {
  const urls: string[] = [];
  const client = new UarpClient({
    apiKey: 'uarp_secret',
    baseURL: 'https://api.example.test',
    sseTokenInQuery: true,
    fetch: async (url: string) => {
      urls.push(url);
      return new Response(bodyOf(['event: run.completed\ndata: {}\n\n']), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });

  await client.runs.streamRunEvents('r1').until((e) => e.event === 'run.completed');

  // Browser proxies that strip Authorization need the key in the URL instead.
  assert.equal(new URL(urls[0]!).searchParams.get('token'), 'uarp_secret');
});

test('leaves the key out of the URL by default', async () => {
  const urls: string[] = [];
  const client = new UarpClient({
    apiKey: 'uarp_secret',
    baseURL: 'https://api.example.test',
    fetch: async (url: string) => {
      urls.push(url);
      return new Response(bodyOf(['event: run.completed\ndata: {}\n\n']), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });

  await client.runs.streamRunEvents('r1').until((e) => e.event === 'run.completed');
  assert.equal(new URL(urls[0]!).searchParams.has('token'), false);
});

test('autoPaginate walks every page', async () => {
  const pages = [
    { items: [1, 2], cursor: 'c1', has_more: true },
    { items: [3], cursor: 'c2', has_more: true },
    { items: [4], cursor: null, has_more: false },
  ];
  const requested: Array<string | undefined> = [];
  const items = await collect(
    autoPaginate<number>(
      async (cursor) => {
        requested.push(cursor);
        return pages[requested.length - 1];
      },
      'items',
      'cursor',
      'has_more',
    ),
  );

  assert.deepEqual(items, [1, 2, 3, 4]);
  assert.deepEqual(requested, [undefined, 'c1', 'c2']);
});

test('autoPaginate walks past an empty page that says there is more', async () => {
  // This API applies the page size before filtering, so a request for two
  // items can come back with none while `has_more` is still true. Treating
  // that as the end of the collection loses every item behind it.
  const pages = [
    { items: [], cursor: 'c1', has_more: true },
    { items: [], cursor: 'c2', has_more: true },
    { items: [1, 2], cursor: null, has_more: false },
  ];
  let call = 0;
  const items = await collect(
    autoPaginate<number>(
      async () => pages[call++],
      'items',
      'cursor',
      'has_more',
    ),
  );

  assert.deepEqual(items, [1, 2]);
});

test('autoPaginate gives up on a server that only ever returns empty pages', async () => {
  let calls = 0;
  const items = await collect(
    autoPaginate<number>(
      async () => ({ items: [], cursor: `c${calls++}`, has_more: true }),
      'items',
      'cursor',
      'has_more',
    ),
  );

  assert.deepEqual(items, []);
  // Bounded: a fresh cursor every time defeats the repeated-cursor guard, so
  // the run of empty pages has to be what stops it.
  assert.ok(calls <= 4, `stopped after ${calls} pages`);
});

test('autoPaginate stops when a server repeats the same cursor', async () => {
  let calls = 0;
  const items = await collect(
    autoPaginate<number>(
      async () => {
        calls++;
        return { items: [calls], cursor: 'same', has_more: true };
      },
      'items',
      'cursor',
      'has_more',
    ),
  );

  assert.deepEqual(items, [1, 2]);
  assert.equal(calls, 2);
});

test('generated listAll stops when a server repeats a cursor', async () => {
  let calls = 0;
  const client = new UarpClient({
    apiKey: 'k',
    baseURL: 'https://api.example.test',
    fetch: async () => {
      calls++;
      // A server that never clears its cursor would page forever.
      return new Response(
        JSON.stringify({ items: [{ agent_id: `a${calls}` }], cursor: 'same', has_more: true }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  const ids: string[] = [];
  for await (const agent of client.agents.listAll()) ids.push(agent.agent_id!);

  assert.deepEqual(ids, ['a1', 'a2']);
  assert.equal(calls, 2);
});

test('generated listAll follows cursors through the transport', async () => {
  const bodies = [
    { items: [{ agent_id: 'a1' }], cursor: 'next', has_more: true },
    { items: [{ agent_id: 'a2' }], cursor: null, has_more: false },
  ];
  const urls: string[] = [];
  let index = 0;
  const client = new UarpClient({
    apiKey: 'k',
    baseURL: 'https://api.example.test',
    fetch: async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(bodies[index++]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const ids: string[] = [];
  for await (const agent of client.agents.listAll({ limit: 1 })) ids.push(agent.agent_id!);

  assert.deepEqual(ids, ['a1', 'a2']);
  assert.equal(new URL(urls[0]!).searchParams.get('cursor'), null);
  assert.equal(new URL(urls[1]!).searchParams.get('cursor'), 'next');
  assert.equal(new URL(urls[1]!).searchParams.get('limit'), '1');
});

// ---- streamPost: a POST answered as server-sent events ---------------------

const CHAT_BODY = { model: 'contract/model', stream: true, messages: [{ role: 'user', content: 'hi' }] };

/** A client whose fetch records every call and answers each with `answer()`. */
function postStreamClient(answer: () => Response, options: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new UarpClient({
    apiKey: 'uarp_test1234_secret',
    baseURL: 'https://api.example.test',
    ...options,
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return answer();
    },
  });
  return { client, calls };
}

function deltaText(event: UarpEvent): string {
  return event.json<{ choices: Array<{ delta?: { content?: string } }> }>().choices[0]?.delta?.content ?? '';
}

test('streamPost POSTs the JSON body for an event stream and stops at [DONE], which it does not deliver', async () => {
  const { client, calls } = postStreamClient(
    () =>
      new Response(
        bodyOf([
          'data: {"choices":[{"index":0,"delta":{"content":"he"}}]}\n\n',
          'data: {"choices":[{"index":0,"delta":{"content":"llo"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
  );

  const events: UarpEvent[] = [];
  for await (const event of client.streamPost('/api/v1/llm/chat/completions', CHAT_BODY)) events.push(event);

  assert.equal(calls.length, 1);
  const { url, init } = calls[0]!;
  assert.equal(url, 'https://api.example.test/api/v1/llm/chat/completions');
  assert.equal(init.method, 'POST');
  const headers = new Headers(init.headers);
  assert.equal(headers.get('authorization'), 'Bearer uarp_test1234_secret');
  assert.equal(headers.get('accept'), 'text/event-stream');
  assert.equal(headers.get('content-type'), 'application/json');
  assert.match(headers.get('idempotency-key') ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(JSON.parse(String(init.body)), CHAT_BODY);

  assert.equal(events.length, 2, 'two data frames, and [DONE] is not an event');
  assert.ok(events.every((e) => e.data !== '[DONE]'));
  assert.equal(events.map(deltaText).join(''), 'hello');
});

test('streamPost ends at the end of the body without reconnecting', async () => {
  let answered = 0;
  const { client, calls } = postStreamClient(
    () =>
      // The first answer ends without [DONE]. A second request is the defect
      // under test; answering it with [DONE] keeps that defect a red result
      // rather than an endless loop (each delivered event resets the budget).
      new Response(
        bodyOf(answered++ === 0 ? ['data: {"choices":[{"index":0,"delta":{"content":"he"}}]}\n\n'] : ['data: [DONE]\n\n']),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
  );

  const events: UarpEvent[] = [];
  // Tiny backoff so a regression that reconnects fails fast instead of slowly.
  const stream = client.streamPost('/api/v1/llm/chat/completions', CHAT_BODY, {
    stream: { baseRetryMillis: 1, maxBackoffMillis: 2 },
  });
  for await (const event of stream) events.push(event);

  assert.equal(events.length, 1);
  assert.equal(calls.length, 1, 'a streamed POST is never replayed');
});

test('streamPost turns a 429 into the API error with its problem document, and never retries it', async () => {
  const { client, calls } = postStreamClient(
    () =>
      new Response(JSON.stringify({ title: 'Too Many Requests', status: 429, detail: 'llm quota exhausted' }), {
        status: 429,
        headers: { 'content-type': 'application/problem+json', 'retry-after': '0' },
      }),
    // A retry budget the unary path would spend on this very status.
    { maxRetries: 2 },
  );

  const events: UarpEvent[] = [];
  await assert.rejects(
    async () => {
      const stream = client.streamPost('/api/v1/llm/chat/completions/refused', CHAT_BODY, {
        stream: { baseRetryMillis: 1, maxBackoffMillis: 2 },
      });
      for await (const event of stream) events.push(event);
    },
    (error: unknown) => {
      assert.ok(error instanceof APIError);
      assert.ok(error instanceof RateLimitError);
      assert.equal(error.status, 429);
      assert.equal(error.problem.detail, 'llm quota exhausted');
      assert.equal(error.problem.title, 'Too Many Requests');
      return true;
    },
  );
  assert.equal(calls.length, 1, 'exactly one request: a replay would bill the model twice');
  assert.equal(events.length, 0, 'the error body is not delivered as events');
});

test('streamPost turns a plain JSON 200 into an API error instead of an empty stream', async () => {
  // What the platform answers when the body leaves out `"stream": true`.
  const completion = { choices: [{ index: 0, message: { role: 'assistant', content: 'hello' } }] };
  const { client, calls } = postStreamClient(
    () => new Response(JSON.stringify(completion), { status: 200, headers: { 'content-type': 'application/json' } }),
  );

  const events: UarpEvent[] = [];
  await assert.rejects(
    async () => {
      for await (const event of client.streamPost('/api/v1/llm/chat/completions', CHAT_BODY)) events.push(event);
    },
    (error: unknown) => {
      assert.ok(error instanceof APIError);
      assert.equal(error.status, 200);
      assert.match(error.problem.detail ?? '', /application\/json/);
      assert.deepEqual(JSON.parse(String(error.problem.body)), completion, 'the body is kept');
      return true;
    },
  );
  assert.equal(events.length, 0);
  assert.equal(calls.length, 1);
});

test('streamPost turns an empty 200 with no content type into an API error', async () => {
  const { client, calls } = postStreamClient(() => new Response(null, { status: 200 }));

  const events: UarpEvent[] = [];
  await assert.rejects(
    async () => {
      for await (const event of client.streamPost('/api/v1/llm/chat/completions', CHAT_BODY)) events.push(event);
    },
    (error: unknown) => {
      assert.ok(error instanceof APIError);
      assert.equal(error.status, 200);
      assert.equal(error.problem.body, '');
      return true;
    },
  );
  assert.equal(events.length, 0);
  assert.equal(calls.length, 1);
});

test('streamPost turns a socket destroyed mid-body into APIConnectionError, after one event and one request', async () => {
  // A real server and the real fetch: the failure under test is the transport's.
  let requests = 0;
  let open: ServerResponse | undefined;
  const server = createServer((req, res) => {
    requests++;
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"index":0,"delta":{"content":"he"}}]}\n\n');
      open = res; // chunked and unfinished: the body is mid-stream
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const client = new UarpClient({ apiKey: 'uarp_test1234_secret', baseURL: `http://127.0.0.1:${port}` });
    const events: UarpEvent[] = [];
    await assert.rejects(
      async () => {
        for await (const event of client.streamPost('/api/v1/llm/chat/completions', CHAT_BODY)) {
          events.push(event);
          open!.socket!.destroy(); // the first event is in hand; now the connection dies
        }
      },
      (error: unknown) => {
        assert.ok(error instanceof APIConnectionError, `got ${String(error)}`);
        assert.ok(error.cause !== undefined, 'the transport error is kept as the cause');
        return true;
      },
    );
    assert.equal(events.length, 1);
    assert.equal(requests, 1, 'a broken streamed POST is not replayed');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
