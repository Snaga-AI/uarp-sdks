import assert from 'node:assert/strict';
import { test } from 'node:test';

import { autoPaginate, collect, parseEventStream, UarpClient, type UarpEvent } from '../dist/index.js';

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
