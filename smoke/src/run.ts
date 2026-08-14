/**
 * Run the whole documented surface against a live server.
 *
 * Every call goes through the TypeScript SDK's own `Transport`, so what this
 * exercises is the shipped code: its encoders, its retry policy, its error
 * mapping. A recording `fetch` sits underneath to keep the raw bytes, which the
 * transport has already parsed away by the time a caller sees them.
 *
 *   node smoke/src/run.ts --dry-run
 *   UARP_API_KEY=… node smoke/src/run.ts --base-url https://api.snaga.ai
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Transport } from '../../packages/typescript/dist/index.js';
import { buildPlan, captureId, loadQuarantine, PHASE_NAMES, type PlannedCall } from './plan.ts';
import { assertClean, redactValue } from './redact.ts';
import { loadSpec, successResponse, type Operation, type Spec } from './spec.ts';
import { synthParameter, synthValue, uuid, type SynthContext } from './synth.ts';
import { scanPrecision, validateResponse, type Divergence } from './validate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

export interface CallRecord {
  operationId: string;
  method: string;
  /** The templated path, as written in the document. */
  path: string;
  /** The path actually requested, with parameters filled in. */
  url: string;
  phase: number;
  scopes: string[];
  summary?: string;
  status: number | null;
  durationMs: number;
  contentType?: string;
  documentedStatuses: string[];
  /** True when a path parameter had to be invented, so a 404 is expected. */
  speculative: boolean;
  bodyStrategy: string;
  requestBody?: unknown;
  responseBody?: unknown;
  divergences: Divergence[];
  covered: string[];
  /** Set only when no response arrived: timeout, connection failure, parse failure. */
  transportError?: string;
  /** The SDK error class the status mapped to, when the call failed. */
  errorKind?: string;
  /** Whether a failure body was the RFC 9457 document the SDKs decode. */
  errorBodyShape?: 'rfc9457' | 'other' | 'empty';
  caution?: string;
  skipped?: string;
}

interface Exchange {
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  rawBody: string;
  status: number;
  contentType?: string;
}

/**
 * Remember the identifiers this run creates.
 *
 * Keyed by the collection that produced them, because `{id}` appears under a
 * dozen different resources and pointing one at another's identifier would send
 * a delete somewhere it was never meant to go. Distinctive names such as
 * `agentId` are also kept globally, so a nested route can borrow one.
 */
class IdStore {
  readonly #byPrefix = new Map<string, string>();
  readonly #byName = new Map<string, string>();
  readonly created: { path: string; name: string; value: string }[] = [];

  static prefixFor(path: string, name: string): string {
    const index = path.indexOf(`/{${name}}`);
    return index === -1 ? path : path.slice(0, index);
  }

  register(collectionPath: string, name: string, value: string): void {
    this.#byPrefix.set(`${collectionPath}:${name}`, value);
    if (name !== 'id' && name !== 'name') this.#byName.set(name, value);
    this.created.push({ path: collectionPath, name, value });
  }

  resolve(path: string, name: string): string | undefined {
    return this.#byPrefix.get(`${IdStore.prefixFor(path, name)}:${name}`) ?? this.#byName.get(name);
  }
}

interface Options {
  spec: string;
  baseURL: string;
  out: string;
  dryRun: boolean;
  delayMs: number;
  limit?: number;
  only?: string;
  allow: Set<string>;
  includeQuarantined: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    spec: resolve(ROOT, 'spec/openapi.json'),
    baseURL: process.env.UARP_BASE_URL ?? 'https://api.snaga.ai',
    out: resolve(ROOT, 'smoke/out'),
    dryRun: false,
    delayMs: 120,
    allow: new Set(),
    includeQuarantined: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => argv[++i] ?? '';
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--spec') options.spec = resolve(next());
    else if (arg === '--base-url') options.baseURL = next();
    else if (arg === '--out') options.out = resolve(next());
    else if (arg === '--delay') options.delayMs = Number(next());
    else if (arg === '--limit') options.limit = Number(next());
    else if (arg === '--only') options.only = next();
    else if (arg === '--allow') options.allow.add(next());
    else if (arg === '--include-quarantined') options.includeQuarantined = true;
    else throw new Error(`unknown flag: ${arg}`);
  }
  return options;
}

/** Wrap fetch so the raw exchange survives the transport's parsing. */
function recordingFetch(slot: { current?: Exchange }): typeof fetch {
  return (async (input: string, init: RequestInit) => {
    const response = await fetch(input, init);
    const clone = response.clone();
    let rawBody = '';
    try {
      rawBody = await clone.text();
    } catch {
      rawBody = '<unreadable>';
    }
    const requestHeaders: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, name) => {
      requestHeaders[name] = value;
    });
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      responseHeaders[name] = value;
    });
    slot.current = {
      requestHeaders,
      responseHeaders,
      rawBody,
      status: response.status,
      contentType: response.headers.get('content-type') ?? undefined,
    };
    return response;
  }) as unknown as typeof fetch;
}

function responseTypeFor(op: Operation): 'json' | 'text' | 'binary' | 'void' {
  const success = successResponse(op);
  if (!success || success.status === '204') return 'void';
  const type = success.contentType ?? 'application/json';
  if (type.includes('json')) return 'json';
  if (type.startsWith('text/')) return 'text';
  return 'binary';
}

/** Replace `format: binary` leaves with a real file part. */
function withFileParts(value: unknown, schema: any, spec: Record<string, any>): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const properties = schema?.properties ?? {};
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [key, child] of Object.entries(properties as Record<string, any>)) {
    if (child?.format === 'binary' || child?.contentMediaType) {
      out[key] = new File([`smoke probe ${new Date().toISOString()}\n`], 'smoke.txt', { type: 'text/plain' });
    }
  }
  return out;
}

function documentedFor(op: Operation, status: number): { schema: any; documented: boolean } {
  const exact = op.responses[String(status)];
  if (exact) return { schema: exact.schema, documented: true };
  const wildcard = op.responses[`${Math.floor(status / 100)}XX`] ?? op.responses.default;
  return { schema: wildcard?.schema, documented: wildcard !== undefined };
}

/** Does the error body look like the RFC 9457 problem document the SDKs expect? */
function problemShape(body: unknown): 'rfc9457' | 'other' | 'empty' {
  if (body === null || body === undefined || body === '') return 'empty';
  if (typeof body !== 'object') return 'other';
  const record = body as Record<string, unknown>;
  return 'title' in record || 'type' in record || 'detail' in record ? 'rfc9457' : 'other';
}

function truncate(value: unknown, max = 4000): unknown {
  const text = JSON.stringify(value);
  if (text === undefined) return value;
  if (text.length <= max) return value;
  return { '<truncated>': `${text.length} bytes`, preview: text.slice(0, max) };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const spec: Spec = loadSpec(options.spec);
  const plan = buildPlan(spec, loadQuarantine(resolve(ROOT, 'smoke/quarantine.json')));

  let calls = plan.calls;
  if (options.only) calls = calls.filter((c) => c.op.path.includes(options.only!) || c.op.id.includes(options.only!));
  if (options.limit !== undefined) calls = calls.slice(0, options.limit);

  console.log(`${spec.title} ${spec.version}`);
  console.log(`${calls.length} calls against ${options.baseURL}`);
  for (const [phase, name] of Object.entries(PHASE_NAMES)) {
    const count = calls.filter((c) => c.phase === Number(phase)).length;
    if (count > 0) console.log(`  ${name.padEnd(28)} ${count}`);
  }

  if (options.dryRun) {
    console.log('\ndry run: nothing was sent');
    for (const call of calls.slice(0, 40)) {
      const mark = call.quarantined ? 'QUARANTINED' : call.bodyStrategy;
      console.log(`  ${call.op.method.padEnd(6)} ${call.op.path.padEnd(56)} ${mark}`);
    }
    if (calls.length > 40) console.log(`  … ${calls.length - 40} more`);
    return;
  }

  const apiKey = process.env.UARP_API_KEY;
  if (!apiKey) throw new Error('UARP_API_KEY is not set');

  const slot: { current?: Exchange } = {};
  const transport = new Transport(
    { apiKey, baseURL: options.baseURL, maxRetries: 1, timeout: 30_000, fetch: recordingFetch(slot) },
    { baseURL: options.baseURL, userAgent: 'uarp-smoke-probe' },
  );

  const runId = uuid().slice(0, 8);
  const ids = new IdStore();
  const synth: SynthContext = { spec: spec.raw, runId, ids: new Map() };
  const echoBodies = new Map<string, unknown>();
  const records: CallRecord[] = [];

  console.log(`\nrun id smoke-${runId}; everything created is named after it\n`);

  let index = 0;
  for (const call of calls) {
    index++;
    const { op } = call;

    if (call.quarantined && !options.includeQuarantined && !options.allow.has(op.id)) {
      records.push(baseRecord(call, '', { skipped: `quarantined: ${call.quarantined}` }));
      continue;
    }

    //  Fill the path. An invented identifier is fine — it still exercises the
    //  route, the authorisation check and the error shape — but the result is
    //  marked so a 404 is not read as a fault.
    let speculative = false;
    let path = op.path;
    for (const name of call.needs) {
      const known = ids.resolve(op.path, name);
      if (known === undefined) speculative = true;
      path = path.replace(`{${name}}`, encodeURIComponent(known ?? uuid()));
    }

    //  Only what the document says is required, plus a small page size.
    const query: Record<string, unknown> = {};
    const headers: Record<string, unknown> = {};
    for (const parameter of op.parameters) {
      if (parameter.in === 'query' && (parameter.required || parameter.name === 'limit')) {
        query[parameter.name] = synthParameter({ ...synth, ids: new Map() }, parameter);
      }
      if (parameter.in === 'header' && parameter.required) {
        headers[parameter.name] = synthParameter({ ...synth, ids: new Map() }, parameter);
      }
    }

    let body: unknown;
    let multipart: object | undefined;
    if (call.bodyStrategy === 'echo-get' && call.echoFrom && echoBodies.has(call.echoFrom)) {
      body = echoBodies.get(call.echoFrom);
    } else if (call.bodyStrategy === 'multipart' && op.requestBody) {
      const { schema } = op.requestBody;
      multipart = withFileParts(synthValue(synth, schema, op.id), schema, spec.raw) as object;
    } else if (op.requestBody) {
      body = synthValue(synth, op.requestBody.schema, op.id);
    }

    slot.current = undefined;
    const started = performance.now();
    let record: CallRecord;
    try {
      const result = await transport.request({
        method: op.method,
        path,
        query,
        headers,
        body,
        multipart,
        idempotent: op.method !== 'GET',
        responseType: responseTypeFor(op),
      });
      record = finish(call, path, started, slot.current, result, speculative, spec);
      if (op.method === 'GET') echoBodies.set(op.id, result);
      for (const name of call.captures) {
        const captured = captureId(result, name);
        if (captured) ids.register(op.path, name, captured);
      }
    } catch (error) {
      record = fromError(call, path, started, slot.current, error, speculative, spec);
    }
    records.push(record);

    const flag = record.divergences.some((d) => d.severity === 'breaking')
      ? '!'
      : record.status !== null && record.status >= 500
        ? 'E'
        : ' ';
    process.stdout.write(
      `${flag} ${String(index).padStart(3)}/${calls.length} ${String(record.status ?? '---').padEnd(4)} ` +
        `${op.method.padEnd(6)} ${op.path.slice(0, 58).padEnd(58)} ${record.durationMs}ms\n`,
    );

    if (options.delayMs > 0) await new Promise((r) => setTimeout(r, options.delayMs));
  }

  mkdirSync(options.out, { recursive: true });
  const payload = JSON.stringify(
    {
      spec: { title: spec.title, version: spec.version },
      baseURL: options.baseURL,
      runId,
      finishedAt: new Date().toISOString(),
      totalOperations: spec.operations.length,
      skippedStreams: plan.skipped.map((s) => ({ operationId: s.op.id, path: s.op.path, reason: s.reason })),
      created: ids.created,
      records,
    },
    null,
    2,
  );
  assertClean(payload, [apiKey]);
  writeFileSync(resolve(options.out, 'results.json'), payload);
  console.log(`\nwrote ${resolve(options.out, 'results.json')}`);
}

function baseRecord(call: PlannedCall, url: string, extra: Partial<CallRecord>): CallRecord {
  return {
    operationId: call.op.id,
    method: call.op.method,
    path: call.op.path,
    url,
    phase: call.phase,
    scopes: call.op.scopes,
    summary: call.op.summary,
    status: null,
    durationMs: 0,
    documentedStatuses: Object.keys(call.op.responses),
    speculative: false,
    bodyStrategy: call.bodyStrategy,
    divergences: [],
    covered: [],
    caution: call.caution,
    ...extra,
  };
}

function finish(
  call: PlannedCall,
  url: string,
  started: number,
  exchange: Exchange | undefined,
  result: unknown,
  speculative: boolean,
  spec: Spec,
): CallRecord {
  const status = exchange?.status ?? 200;
  const { schema } = documentedFor(call.op, status);
  const validation = validateResponse(spec.raw, result, schema);
  const divergences = [...validation.divergences];
  if (exchange?.rawBody) divergences.push(...scanPrecision(exchange.rawBody));

  return baseRecord(call, url, {
    status,
    durationMs: Math.round(performance.now() - started),
    contentType: exchange?.contentType,
    speculative,
    responseBody: truncate(redactValue(result)),
    divergences,
    covered: validation.covered,
  });
}

function fromError(
  call: PlannedCall,
  url: string,
  started: number,
  exchange: Exchange | undefined,
  error: unknown,
  speculative: boolean,
  spec: Spec,
): CallRecord {
  const durationMs = Math.round(performance.now() - started);
  const status = exchange?.status ?? (error as any)?.status ?? null;

  if (status === null) {
    //  No response at all: a timeout, a connection failure, or a body the
    //  transport could not parse. All three are worth reporting.
    return baseRecord(call, url, {
      durationMs,
      speculative,
      transportError: (error as Error)?.message ?? String(error),
      errorKind: (error as Error)?.constructor?.name,
    });
  }

  let parsed: unknown = exchange?.rawBody;
  try {
    if (exchange?.rawBody) parsed = JSON.parse(exchange.rawBody);
  } catch {
    //  Left as text; the report calls out error bodies that are not JSON.
  }

  const { schema } = documentedFor(call.op, status);
  const validation = validateResponse(spec.raw, parsed, schema);

  return baseRecord(call, url, {
    status,
    durationMs,
    contentType: exchange?.contentType,
    speculative,
    responseBody: truncate(redactValue(parsed)),
    divergences: validation.divergences,
    covered: validation.covered,
    errorKind: (error as Error)?.constructor?.name,
    errorBodyShape: problemShape(parsed),
  });
}

await main();
