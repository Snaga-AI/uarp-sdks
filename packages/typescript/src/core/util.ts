/** Small helpers used by generated code and by the transport. */

/**
 * Copy the listed keys out of `source`, dropping `undefined` values so they
 * never reach the wire. Generated resource methods use this to split a single
 * params object into query and header maps.
 */
export function pick<T extends object, K extends readonly (keyof T & string)[]>(
  source: T | undefined,
  keys: K,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!source) return out;
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** RFC 4122 v4 identifier; falls back to `Math.random` where crypto is absent. */
export function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Percent-encode one query name or value.
 *
 * Deliberately stricter than `encodeURIComponent`: everything outside the RFC
 * 3986 unreserved set is escaped. Leaving a sub-delimiter such as `+` or `*`
 * unescaped is legal in a URL but changes what a form-decoding server reads
 * back, and the five SDKs have to agree byte for byte.
 */
export function encodeQueryComponent(value: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(value)) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(char)) out += char;
    else out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** Serialise a query map; arrays repeat the key, `undefined`/`null` are skipped. */
export function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const pairs: string[] = [];
  const add = (key: string, value: unknown): void => {
    pairs.push(`${encodeQueryComponent(key)}=${encodeQueryComponent(String(value))}`);
  };

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) add(key, item);
      }
    } else if (typeof value === 'object') {
      add(key, JSON.stringify(value));
    } else {
      add(key, value);
    }
  }
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/** Join a base URL and a path without doubling or dropping slashes. */
export function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

/** `Retry-After` in seconds, accepting both the delta and HTTP-date forms. */
export function parseRetryAfter(headers: Headers, now: number = Date.now()): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number.parseFloat(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}

/** Full-jitter exponential backoff, capped at 8 s. */
export function backoffDelay(attempt: number): number {
  const capped = Math.min(8000, 500 * 2 ** attempt);
  return Math.round(capped * (0.5 + Math.random() * 0.5));
}

/**
 * Half-deterministic backoff for SSE reconnects: `maxSleep/2 + rand(0..maxSleep/2)`,
 * so it climbs with attempts but clients don't all wake on the same boundary.
 * Mirrors the Kotlin `streamBackoff`. Separate from `backoffDelay` (unary retries).
 */
export function streamBackoffDelay(
  attempt: number,
  baseIntervalMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const exponential = baseIntervalMs * 2 ** Math.max(attempt - 1, 0);
  const maxSleep = Math.min(maxDelayMs, exponential);
  const half = Math.max(maxSleep / 2, 1);
  return Math.round(half + random() * half);
}
