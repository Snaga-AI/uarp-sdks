/** Server-sent events: frame parsing, reconnection and an async-iterable stream. */
import { APIConnectionError, APIError } from './errors.js';
import type { JsonValue } from './json.js';
import { sleep, streamBackoffDelay } from './util.js';

export interface UarpEvent {
  /** `id:` field (or the `event_id` inside an inline JSON frame); replayed as `Last-Event-ID` when reconnecting. */
  id?: string;
  /** `event:` field, the `type` inside a JSON payload, or `message`. */
  event: string;
  /** Raw `data:` payload with the trailing newline removed. */
  data: string;
  /** `retry:` field in milliseconds, when the server sent one. */
  retry?: number;
  /** Parse `data` as JSON. Throws `SyntaxError` for non-JSON frames. */
  json<T = JsonValue>(): T;
}

/** Connection-lifecycle states reported by `EventStream` via `EventStreamOptions.onState`. */
export type StreamState =
  | { type: 'connecting' }
  | { type: 'connected' }
  | { type: 'reconnecting'; attempt: number }
  | { type: 'disconnected' };

/**
 * Side-channel from `parseEventStream` to `EventStream`: the decoder sets
 * `isDone` when it sees `data: [DONE]`, so the reconnect loop can tell a hard
 * terminal (no reconnect) from a clean EOF (reconnect). `for await…of` cannot
 * read a generator's return value, so the loop reads this instead.
 */
export class DecoderState {
  isDone = false;
  /** Mark the stream as terminated by `data: [DONE]`. */
  markDone(): void {
    this.isDone = true;
  }
}

export interface EventStreamOptions {
  signal?: AbortSignal;
  /** Reconnect with `Last-Event-ID` when the stream drops. Default `true`. */
  reconnect?: boolean;
  /** Consecutive reconnect attempts before giving up. Default `5`. */
  maxReconnects?: number;
  /** Event names that complete the stream WITHOUT reconnecting. Empty by default. */
  terminalEvents?: Set<string>;
  /** Max silence between reads before the socket is presumed dead and a reconnect
   *  is attempted. `undefined` disables the watchdog (EOF owns liveness). */
  inactivityTimeoutMillis?: number;
  /** Base reconnect interval in ms; a `retry:` field overrides it per stream. */
  baseRetryMillis?: number;
  /** Cap on the reconnect backoff. */
  maxBackoffMillis?: number;
  /** Reconnect budget resets after this long connected without a disconnect. */
  stabilityResetMillis?: number;
  /** Optional connection-lifecycle observer. `disconnected` is NOT fired when the
   *  caller aborts the stream — only on a natural end. */
  onState?: (state: StreamState) => void;
  /** Injectable clock/random for tests; default `Date.now`/`Math.random`. */
  now?: () => number;
  random?: () => number;
}

/** Opens the underlying HTTP response; called again for every reconnect. */
export type StreamConnector = (lastEventId: string | undefined, signal: AbortSignal) => Promise<Response>;

/**
 * A live SSE stream.
 *
 * ```ts
 * const stream = client.runs.streamRunEvents(runId);
 * for await (const event of stream) {
 *   if (event.event === 'run.completed') break;
 * }
 * ```
 *
 * Breaking out of the loop (or calling `close()`) aborts the HTTP request.
 */
export class EventStream implements AsyncIterable<UarpEvent> {
  readonly #connect: StreamConnector;
  readonly #controller = new AbortController();
  readonly #reconnect: boolean;
  readonly #maxReconnects: number;
  readonly #terminalEvents: Set<string>;
  readonly #inactivityTimeout: number | undefined;
  readonly #baseRetry: number;
  readonly #maxBackoff: number;
  readonly #stabilityReset: number;
  readonly #onState: ((state: StreamState) => void) | undefined;
  readonly #now: () => number;
  readonly #random: () => number;
  #lastEventId: string | undefined;
  #consumed = false;

  constructor(connect: StreamConnector, options: EventStreamOptions = {}) {
    this.#connect = connect;
    this.#reconnect = options.reconnect ?? true;
    this.#maxReconnects = options.maxReconnects ?? 5;
    this.#terminalEvents = options.terminalEvents ?? new Set();
    this.#inactivityTimeout = options.inactivityTimeoutMillis;
    this.#baseRetry = options.baseRetryMillis ?? 2_000;
    this.#maxBackoff = options.maxBackoffMillis ?? 8_000;
    this.#stabilityReset = options.stabilityResetMillis ?? 60_000;
    this.#onState = options.onState;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
    if (options.signal) {
      const abort = () => this.#controller.abort(options.signal!.reason);
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }
  }

  /** Abort the connection and end iteration. */
  close(): void {
    this.#controller.abort();
  }

  get closed(): boolean {
    return this.#controller.signal.aborted;
  }

  /** Resolve once an event matching `predicate` arrives, then close the stream. */
  async until(predicate: (event: UarpEvent) => boolean): Promise<UarpEvent | undefined> {
    for await (const event of this) {
      if (predicate(event)) {
        this.close();
        return event;
      }
    }
    return undefined;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<UarpEvent> {
    if (this.#consumed) throw new Error('EventStream has already been consumed');
    this.#consumed = true;

    let attempt = 0;
    let baseRetry = this.#baseRetry;
    this.#onState?.({ type: 'connecting' });

    while (!this.#controller.signal.aborted) {
      let response: Response;
      try {
        response = await this.#connect(this.#lastEventId, this.#controller.signal);
      } catch (error) {
        if (this.#controller.signal.aborted) return;
        // 401 always surfaces so the caller can act on it (the app stops the
        // stream); any other connector error retries like a dropped connection.
        if (error instanceof APIError && error.status === 401) throw error;
        if (!this.#reconnect || attempt >= this.#maxReconnects) throw error;
        this.#onState?.({ type: 'reconnecting', attempt: attempt + 1 });
        await sleep(
          streamBackoffDelay(attempt + 1, baseRetry, this.#maxBackoff, this.#random),
          this.#controller.signal,
        );
        attempt++;
        continue;
      }

      if (!response.body) {
        throw new APIConnectionError('Event stream response has no body');
      }

      this.#onState?.({ type: 'connected' });

      // A connection that delivered at least one event counts as progress and
      // resets the reconnect budget; one that closed immediately does not, so
      // a flapping server cannot spin this loop forever.
      let delivered = false;
      let terminal = false;
      let clean = false;
      const decoder = new DecoderState();
      const connectedAt = this.#now();
      try {
        for await (const event of parseEventStream(response.body, this.#controller.signal, {
          inactivityTimeoutMillis: this.#inactivityTimeout,
          state: decoder,
        })) {
          if (event.id !== undefined) this.#lastEventId = event.id;
          if (event.retry && event.retry > 0) baseRetry = event.retry;
          delivered = true;
          yield event;
          if (this.#terminalEvents.has(event.event)) {
            terminal = true;
            break;
          }
        }
        clean = true;
      } finally {
        // Breaking out of the caller's `for await` lands here.
        if (!clean) this.#controller.abort();
      }
      // `data: [DONE]` is a hard terminal: no reconnect.
      if (decoder.isDone) terminal = true;
      if (terminal) {
        this.#onState?.({ type: 'disconnected' });
        return;
      }

      // A healthy connection that survived the stability window shouldn't carry
      // "this is the Nth retry" baggage into its next disconnect.
      if (attempt > 0 && this.#now() - connectedAt >= this.#stabilityReset) attempt = 0;
      if (delivered) attempt = 0;

      if (!this.#reconnect || this.#controller.signal.aborted) {
        this.#onState?.({ type: 'disconnected' });
        return;
      }
      if (attempt >= this.#maxReconnects) {
        this.#onState?.({ type: 'disconnected' });
        return;
      }
      this.#onState?.({ type: 'reconnecting', attempt: attempt + 1 });
      await sleep(
        streamBackoffDelay(attempt + 1, baseRetry, this.#maxBackoff, this.#random),
        this.#controller.signal,
      );
      attempt++;
    }
  }
}

/** Decode an SSE byte stream into events, per the WHATWG event-stream rules. */
export async function* parseEventStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  options?: { inactivityTimeoutMillis?: number; state?: DecoderState },
): AsyncGenerator<UarpEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const inactivityTimeout = options?.inactivityTimeoutMillis;
  const state = options?.state;
  let buffer = '';
  let dataLines: string[] = [];
  let eventName = '';
  let id: string | undefined;
  let retry: number | undefined;
  let hasFields = false;

  const flush = (): UarpEvent | undefined => {
    if (!hasFields) return undefined;
    hasFields = false;
    const data = dataLines.join('\n');
    const eventId = id;
    const eventResolved = eventName;
    const retryOut = retry;
    dataLines = [];
    eventName = '';
    id = undefined; // `id` is per-frame, not persisted across frames.
    retry = undefined;
    // A frame with no `data:` is not a deliverable event: an `id:`/`retry:`-only
    // frame updates state but carries nothing to emit.
    if (data.length === 0) return undefined;
    const resolved = eventResolved || extractEventType(data) || 'message';
    return makeEvent({ id: eventId, event: resolved, data, retry: retryOut });
  };

  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for (;;) {
      // Per-read inactivity watchdog: race the read against a timer that
      // *resolves* (it does not reject or abort the caller's signal). On
      // timeout the socket is silent but not closed — release the read and let
      // the loop reconnect with `Last-Event-ID` rather than treating the
      // silence as a finished stream.
      let readResult: ReadableStreamReadResult<Uint8Array> | 'timeout';
      if (inactivityTimeout) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), inactivityTimeout);
        });
        readResult = await Promise.race([reader.read(), timeout]);
        if (timer) clearTimeout(timer);
      } else {
        readResult = await reader.read();
      }
      if (readResult === 'timeout') {
        await reader.cancel().catch(() => {});
        return;
      }
      const { done, value } = readResult;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.search(/\r\n|\r|\n/)) !== -1) {
        const matched = /\r\n|\r|\n/.exec(buffer.slice(newline))![0];
        // A lone trailing '\r' may be the first half of a CRLF split across chunks.
        if (matched === '\r' && newline === buffer.length - 1) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + matched.length);

        if (line === '') {
          const event = flush();
          if (event) yield event;
          continue;
        }
        // SSE comment. The platform also carries a JSON object in a comment
        // (`:{"type":"…","event_id":"…"}`); that is a self-contained frame.
        // A bare comment is a keep-alive.
        if (line.startsWith(':')) {
          const body = line.slice(1).trim();
          if (body.startsWith('{')) yield inlineEvent(body);
          continue;
        }
        // Bare NDJSON line — a self-contained frame with no field prefix.
        if (line.startsWith('{')) {
          yield inlineEvent(line);
          continue;
        }

        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);

        hasFields = true;
        switch (field) {
          case 'event':
            eventName = value;
            break;
          case 'data':
            if (value === '[DONE]') {
              state?.markDone();
              const flushed = flush();
              if (flushed) yield flushed;
              return; // hard terminal — the loop reconnects on nothing.
            }
            dataLines.push(value);
            break;
          case 'id':
            if (!value.includes('\0')) id = value;
            break;
          case 'retry': {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed)) retry = parsed;
            break;
          }
          default:
            break; // unknown fields are ignored
        }
      }
    }
    const trailing = flush();
    if (trailing) yield trailing;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock?.();
  }
}

/** A comment-JSON or NDJSON frame: type and id live inside the JSON body. */
function inlineEvent(body: string): UarpEvent {
  return makeEvent({
    id: extractField(body, 'event_id'),
    event: extractEventType(body) || 'message',
    data: body,
  });
}

function makeEvent(fields: { id?: string; event: string; data: string; retry?: number }): UarpEvent {
  return {
    ...fields,
    json<T = JsonValue>(): T {
      return JSON.parse(fields.data) as T;
    },
  };
}

/**
 * Pull one string field out of a JSON body WITHOUT fully decoding it — the
 * stream carries thousands of frames a minute, and a full parse per frame to
 * learn its `type` is the difference between a smooth stream and a stuttering
 * one. Honours escaped quotes so a `"` inside a value can't fool it.
 */
export function extractField(json: string, field: string): string | undefined {
  const needle = `"${field}"`;
  const start = json.indexOf(needle);
  if (start < 0) return undefined;
  let i = start + needle.length;
  while (i < json.length && (json[i] === ':' || json[i] === ' ')) i++;
  if (i >= json.length || json[i] !== '"') return undefined;
  i++;
  const valueStart = i;
  while (i < json.length) {
    const c = json[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '"') break;
    i++;
  }
  if (i <= valueStart) return undefined;
  return json.slice(valueStart, i);
}

/** The `type` field of a JSON frame, peeked without decoding. */
export function extractEventType(json: string): string | undefined {
  return extractField(json, 'type');
}