import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  APIError,
  EventStream,
  parseEventStream,
  type UarpEvent,
} from '../dist/index.js';

const FIXTURE_DIR = new URL('../../../contract/sse-fixtures/', import.meta.url);
const mixedBytes = readFileSync(new URL('mixed.txt', FIXTURE_DIR));
const expected = JSON.parse(readFileSync(new URL('mixed.expected.json', FIXTURE_DIR), 'utf8')) as Array<{
  id: string | null;
  event: string;
  data: string;
  retry: number | null;
}>;

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function decode(bytes: Uint8Array): Promise<UarpEvent[]> {
  const out: UarpEvent[] = [];
  for await (const event of parseEventStream(streamOf(bytes))) out.push(event);
  return out;
}

test('decodes the shared mixed-format fixture to the locked expected output', async () => {
  // Kotlin locks mixed.expected.json; the four SDK ports replay the same bytes
  // and must match. A parser that dropped comments or unknown lines (the stock
  // SDK parser) would emit only the standard frames here.
  const events = await decode(mixedBytes);
  assert.equal(events.length, expected.length, 'event count');
  events.forEach((e, i) => {
    assert.equal(e.id ?? null, expected[i]!.id, `event[${i}].id`);
    assert.equal(e.event, expected[i]!.event, `event[${i}].event`);
    assert.equal(e.data, expected[i]!.data, `event[${i}].data`);
    assert.equal(e.retry ?? null, expected[i]!.retry, `event[${i}].retry`);
  });
});

test('a terminal event completes the stream without reconnecting', async () => {
  let calls = 0;
  const stream = new EventStream(async () => {
    calls++;
    return new Response(streamOf(new TextEncoder().encode('event: run.completed\ndata: {}\n\n')), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }, { terminalEvents: new Set(['run.completed']) });

  const events: UarpEvent[] = [];
  for await (const event of stream) events.push(event);

  assert.deepEqual(events.map((e) => e.event), ['run.completed']);
  assert.equal(calls, 1, 'terminal event must not reconnect');
});

test('a DONE frame terminates without reconnecting', async () => {
  let calls = 0;
  const stream = new EventStream(async () => {
    calls++;
    return new Response(
      streamOf(new TextEncoder().encode('data: {"text":"hi"}\n\ndata: [DONE]\n\n')),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  });

  const events: UarpEvent[] = [];
  for await (const event of stream) events.push(event);

  assert.equal(events.length, 1);
  assert.equal(events[0]!.data, '{"text":"hi"}');
  assert.equal(calls, 1, '[DONE] must not reconnect');
});

test('the inactivity watchdog reconnects a silent socket with Last-Event-ID', async () => {
  const enc = new TextEncoder();
  const seen: Array<string | null> = [];
  let calls = 0;
  const stream = new EventStream(
    async (lastEventId) => {
      calls++;
      seen.push(lastEventId ?? null);
      if (calls === 1) {
        // One frame, then the socket goes silent — never closes, never sends more.
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode('id: 1\nevent: llm.chunk\ndata: {"text":"he"}\n\n'));
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }
      return new Response(
        streamOf(enc.encode('event: run.completed\ndata: {}\n\n')),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    },
    {
      terminalEvents: new Set(['run.completed']),
      inactivityTimeoutMillis: 20,
      // Deterministic, tiny backoff so the test is fast.
      baseRetryMillis: 1,
      maxBackoffMillis: 2,
      random: () => 0,
    },
  );

  const events: UarpEvent[] = [];
  for await (const event of stream) events.push(event);

  assert.deepEqual(events.map((e) => e.event), ['llm.chunk', 'run.completed']);
  assert.equal(calls, 2, 'silent socket must trigger a reconnect');
  assert.equal(seen[0], null, 'first attempt carries no resume id');
  assert.equal(seen[1], '1', 'reconnect replays the last delivered id');
});

test('a 401 surfaces without retrying', async () => {
  let calls = 0;
  const stream = new EventStream(async () => {
    calls++;
    throw new APIError(401, { title: 'Unauthorized' }, new Headers());
  });

  await assert.rejects(
    async () => {
      for await (const _event of stream) void _event;
    },
    (err: unknown) => err instanceof APIError && (err as APIError).status === 401,
  );
  assert.equal(calls, 1, '401 must not retry');
});

test('reports connection lifecycle via onState', async () => {
  const states: string[] = [];
  const stream = new EventStream(
    async () =>
      new Response(streamOf(new TextEncoder().encode('event: run.completed\ndata: {}\n\n')), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    {
      terminalEvents: new Set(['run.completed']),
      onState: (s) => states.push(s.type),
    },
  );

  for await (const _event of stream) void _event;
  assert.deepEqual(states, ['connecting', 'connected', 'disconnected']);
});