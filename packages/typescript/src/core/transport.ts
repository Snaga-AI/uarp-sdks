/** HTTP transport: auth, retries, idempotency, body encoding, error mapping. */
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  errorForStatus,
  type ProblemDocument,
} from './errors.js';
import type { BinaryInput, FileInput } from './json.js';
import { EventStream, type EventStreamOptions } from './sse.js';
import { backoffDelay, buildQuery, joinUrl, parseRetryAfter, randomId, sleep } from './util.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** API key in `uarp_<prefix>_<secret>` form. Defaults to `$UARP_API_KEY`. */
  apiKey?: string;
  /** Overrides the production base URL. Defaults to `$UARP_BASE_URL`. */
  baseURL?: string;
  /** Per-request timeout in milliseconds. Default `60000`. */
  timeout?: number;
  /** Retries for transient failures. Default `2`. */
  maxRetries?: number;
  /** Headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /** Custom fetch implementation (proxies, instrumentation, tests). */
  fetch?: FetchLike;
  /** Appended to the SDK's own User-Agent. */
  userAgent?: string;
  /** Generates `Idempotency-Key` values. Default: a random UUID per request. */
  idempotencyKey?: () => string;
  /**
   * Send the API key as `?token=` instead of an `Authorization` header on SSE
   * requests. Needed for browser `EventSource`-style proxies. Default `false`.
   */
  sseTokenInQuery?: boolean;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Overrides the client timeout for this call. */
  timeout?: number;
  /** Overrides the client retry budget for this call. */
  maxRetries?: number;
  /** Extra headers; `undefined` removes a default header. */
  headers?: Record<string, string | undefined>;
  /** Reuse a specific idempotency key, e.g. to safely replay a create. */
  idempotencyKey?: string;
  /** Extra query parameters merged into the generated ones. */
  query?: Record<string, unknown>;
  /** Per-call base URL override. */
  baseURL?: string;
  /** SSE-only knobs; ignored by unary requests. */
  stream?: EventStreamOptions;
}

export type ResponseType = 'json' | 'binary' | 'text' | 'void';

/** The wire description a generated method hands to the transport. */
export interface RequestSpec {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  body?: unknown;
  /** URL-encoded form fields. */
  form?: object;
  /** Multipart parts; `FileInput` values become file parts, the rest are fields. */
  multipart?: object;
  binary?: BinaryInput;
  /** Attach an `Idempotency-Key`, which also makes the call safe to retry. */
  idempotent?: boolean;
  responseType?: ResponseType;
  options?: RequestOptions;
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

export class Transport {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly timeout: number;
  readonly maxRetries: number;
  readonly defaultHeaders: Record<string, string>;
  readonly #fetch: FetchLike;
  readonly #userAgent: string;
  readonly #idempotencyKey: () => string;
  readonly #sseTokenInQuery: boolean;

  constructor(options: ClientOptions, defaults: { baseURL: string; userAgent: string }) {
    const env = readEnv();
    const apiKey = options.apiKey ?? env('UARP_API_KEY') ?? env('SNAGA_API_KEY');
    if (!apiKey) {
      throw new Error(
        'Missing API key. Pass `new UarpClient({ apiKey })` or set the UARP_API_KEY environment variable.',
      );
    }
    this.apiKey = apiKey;
    this.baseURL = (options.baseURL ?? env('UARP_BASE_URL') ?? defaults.baseURL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? 60_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.#userAgent = options.userAgent ? `${defaults.userAgent} ${options.userAgent}` : defaults.userAgent;
    this.#idempotencyKey = options.idempotencyKey ?? randomId;
    this.#sseTokenInQuery = options.sseTokenInQuery ?? false;

    const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) {
      throw new Error('No global fetch available. Pass `fetch` in the client options.');
    }
    this.#fetch = fetchImpl;
  }

  /** Perform a unary request, retrying transient failures. */
  async request<T>(spec: RequestSpec): Promise<T> {
    const options = spec.options ?? {};
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const idempotencyKey = spec.idempotent ? options.idempotencyKey ?? this.#idempotencyKey() : undefined;
    let attempt = 0;

    for (;;) {
      const timeoutMs = options.timeout ?? this.timeout;
      const controller = new AbortController();
      const onAbort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new APITimeoutError()), timeoutMs);

      let response: Response;
      try {
        if (options.signal?.aborted) throw options.signal.reason ?? new APIConnectionError('Request aborted');
        response = await this.#send(spec, controller.signal, idempotencyKey);
      } catch (error) {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (options.signal?.aborted) throw options.signal.reason ?? new APIConnectionError('Request aborted');
        const wrapped =
          controller.signal.aborted && controller.signal.reason instanceof APITimeoutError
            ? new APITimeoutError(`Request timed out after ${timeoutMs} ms`)
            : new APIConnectionError('Connection error', { cause: error });
        if (attempt >= maxRetries || !this.#retryable(spec, idempotencyKey)) throw wrapped;
        await sleep(backoffDelay(attempt++), options.signal);
        continue;
      }
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);

      if (response.ok) return (await decodeBody(response, spec.responseType ?? 'json')) as T;

      const problem = await readProblem(response);
      const error = errorForStatus(response.status, problem, response.headers);
      const retryable =
        RETRYABLE_STATUS.has(response.status) &&
        response.headers.get('x-should-retry') !== 'false' &&
        this.#retryable(spec, idempotencyKey);
      if (!retryable || attempt >= maxRetries) throw error;

      const wait = parseRetryAfter(response.headers) ?? backoffDelay(attempt);
      attempt++;
      await sleep(Math.min(wait, 60_000), options.signal);
    }
  }

  /** Open a server-sent event stream. The request is issued on first iteration. */
  stream(spec: RequestSpec): EventStream {
    const options = spec.options ?? {};
    return new EventStream(async (lastEventId, signal) => {
      const headers: Record<string, unknown> = { ...spec.headers, Accept: 'text/event-stream' };
      if (lastEventId) headers['Last-Event-ID'] = lastEventId;
      const query = this.#sseTokenInQuery ? { ...spec.query, token: this.apiKey } : spec.query;
      const response = await this.#send({ ...spec, headers, query }, signal, undefined);
      if (!response.ok) {
        throw errorForStatus(response.status, await readProblem(response), response.headers);
      }
      return response;
    }, options.stream ?? { signal: options.signal });
  }

  /** Build and issue exactly one HTTP request. */
  async #send(spec: RequestSpec, signal: AbortSignal, idempotencyKey: string | undefined): Promise<Response> {
    const options = spec.options ?? {};
    const baseURL = options.baseURL ?? this.baseURL;
    const query = { ...spec.query, ...options.query };
    const url = joinUrl(baseURL, spec.path) + buildQuery(query);

    const headers = new Headers();
    headers.set('Accept', 'application/json');
    headers.set('User-Agent', this.#userAgent);
    headers.set('Authorization', `Bearer ${this.apiKey}`);
    for (const [key, value] of Object.entries(this.defaultHeaders)) headers.set(key, value);
    for (const [key, value] of Object.entries(spec.headers ?? {})) {
      if (value !== undefined && value !== null) headers.set(key, String(value));
    }
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);

    const body = encodeBody(spec, headers);
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      if (value === undefined) headers.delete(key);
      else headers.set(key, value);
    }

    return this.#fetch(url, { method: spec.method, headers, body, signal, redirect: 'follow' });
  }

  /** Reads are always safe; writes only when the server can dedupe them. */
  #retryable(spec: RequestSpec, idempotencyKey: string | undefined): boolean {
    if (spec.method === 'GET' || spec.method === 'HEAD') return true;
    return idempotencyKey !== undefined;
  }
}

function encodeBody(spec: RequestSpec, headers: Headers): BodyInit | undefined {
  if (spec.multipart) {
    const form = new FormData();
    for (const [key, value] of Object.entries(spec.multipart as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      appendPart(form, key, value);
    }
    // Let fetch set the multipart boundary.
    headers.delete('Content-Type');
    return form;
  }
  if (spec.form) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(spec.form as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      params.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
    return params;
  }
  if (spec.binary !== undefined) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream');
    return toBodyInit(spec.binary);
  }
  if (spec.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    return JSON.stringify(spec.body);
  }
  return undefined;
}

function appendPart(form: FormData, key: string, value: unknown): void {
  if (value instanceof Blob) {
    form.append(key, value);
    return;
  }
  if (typeof value === 'object' && value !== null && 'data' in (value as Record<string, unknown>)) {
    const part = value as { data: BinaryInput; filename?: string; contentType?: string };
    const blob = part.data instanceof Blob ? part.data : new Blob([toBodyInit(part.data) as BlobPart], {
      type: part.contentType ?? 'application/octet-stream',
    });
    form.append(key, blob, part.filename ?? 'file');
    return;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    form.append(key, new Blob([value as BlobPart]), 'file');
    return;
  }
  form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
}

function toBodyInit(value: BinaryInput): BodyInit {
  if (typeof value === 'string') return value;
  if (value instanceof Blob) return value;
  if (value instanceof ArrayBuffer) return value;
  return value as ArrayBufferView as BodyInit;
}

async function decodeBody(response: Response, type: ResponseType): Promise<unknown> {
  if (type === 'void' || response.status === 204) {
    await response.body?.cancel().catch(() => {});
    return undefined;
  }
  if (type === 'binary') return response.blob();
  if (type === 'text') return response.text();
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readProblem(response: Response): Promise<ProblemDocument> {
  try {
    const text = await response.text();
    if (!text) return { status: response.status };
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as ProblemDocument;
    return { status: response.status, detail: String(parsed) };
  } catch {
    return { status: response.status };
  }
}

function readEnv(): (name: string) => string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return (name) => env?.[name];
}

export { APIError };
