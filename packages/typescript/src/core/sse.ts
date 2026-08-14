/** Server-sent events: frame parsing, reconnection and an async-iterable stream. */
import { APIConnectionError } from './errors.js';
import type { JsonValue } from './json.js';
import { backoffDelay, sleep } from './util.js';

export interface UarpEvent {
  /** `id:` field; also replayed as `Last-Event-ID` when reconnecting. */
  id?: string;
  /** `event:` field, defaulting to `message`. */
  event: string;
  /** Raw `data:` payload with the trailing newline removed. */
  data: string;
  /** `retry:` field in milliseconds, when the server sent one. */
  retry?: number;
  /** Parse `data` as JSON. Throws `SyntaxError` for non-JSON frames. */
  json<T = JsonValue>(): T;
}

export interface EventStreamOptions {
  signal?: AbortSignal;
  /** Reconnect with `Last-Event-ID` when the stream drops. Default `true`. */
  reconnect?: boolean;
  /** Consecutive reconnect attempts before giving up. Default `5`. */
  maxReconnects?: number;
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
  #lastEventId: string | undefined;
  #consumed = false;

  constructor(connect: StreamConnector, options: EventStreamOptions = {}) {
    this.#connect = connect;
    this.#reconnect = options.reconnect ?? true;
    this.#maxReconnects = options.maxReconnects ?? 5;
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
    while (!this.#controller.signal.aborted) {
      let response: Response;
      try {
        response = await this.#connect(this.#lastEventId, this.#controller.signal);
      } catch (error) {
        if (this.#controller.signal.aborted) return;
        if (!this.#reconnect || attempt >= this.#maxReconnects) throw error;
        await sleep(backoffDelay(attempt++), this.#controller.signal);
        continue;
      }

      if (!response.body) {
        throw new APIConnectionError('Event stream response has no body');
      }

      // A connection that delivered at least one event counts as progress and
      // resets the reconnect budget; one that closed immediately does not, so a
      // flapping server cannot spin this loop forever.
      let delivered = false;
      let clean = false;
      try {
        for await (const event of parseEventStream(response.body, this.#controller.signal)) {
          if (event.id !== undefined) this.#lastEventId = event.id;
          delivered = true;
          yield event;
        }
        clean = true;
      } finally {
        // Breaking out of the caller's `for await` lands here.
        if (!clean) this.#controller.abort();
      }
      if (delivered) attempt = 0;

      if (!this.#reconnect || this.#controller.signal.aborted) return;
      if (attempt >= this.#maxReconnects) return;
      await sleep(backoffDelay(attempt++), this.#controller.signal);
    }
  }
}

/** Decode an SSE byte stream into events, per the WHATWG event-stream rules. */
export async function* parseEventStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<UarpEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let dataLines: string[] = [];
  let eventName = '';
  let id: string | undefined;
  let retry: number | undefined;

  const flush = (): UarpEvent | undefined => {
    if (dataLines.length === 0 && eventName === '') {
      id = undefined;
      return undefined;
    }
    const data = dataLines.join('\n');
    const event = makeEvent({ id, event: eventName || 'message', data, retry });
    dataLines = [];
    eventName = '';
    retry = undefined;
    return event;
  };

  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
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
        if (line.startsWith(':')) continue; // comment / keep-alive

        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);

        switch (field) {
          case 'event':
            eventName = value;
            break;
          case 'data':
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

function makeEvent(fields: { id?: string; event: string; data: string; retry?: number }): UarpEvent {
  return {
    ...fields,
    json<T = JsonValue>(): T {
      return JSON.parse(fields.data) as T;
    },
  };
}
