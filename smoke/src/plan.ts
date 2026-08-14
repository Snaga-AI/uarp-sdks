/**
 * Decide what to call, in what order, with what body.
 *
 * Two constraints shape the ordering. A resource has to exist before it can be
 * read, updated or deleted, so creates come first and deletes last. And a
 * delete must only ever point at something this run made — the target tenant is
 * production, and a `DELETE /agents/{agentId}` aimed at a discovered id would
 * destroy real work.
 */
import { readFileSync } from 'node:fs';
import type { Operation, Spec } from './spec.ts';

export type BodyStrategy = 'none' | 'synth' | 'echo-get' | 'multipart';

export interface PlannedCall {
  op: Operation;
  phase: Phase;
  /** Path prefix up to the first parameter; groups an operation with its siblings. */
  family: string;
  depth: number;
  bodyStrategy: BodyStrategy;
  /** For `echo-get`: the operation whose response is sent back unchanged. */
  echoFrom?: string;
  /** Path parameters that must be known before this call can run. */
  needs: string[];
  /** Path-parameter names to register from this call's response. */
  captures: string[];
  quarantined?: string;
  caution?: string;
}

//  A plain object rather than an `enum`: Node runs these files by stripping
//  types, and an enum is the one TypeScript construct that emits runtime code.
export const Phase = {
  Public: 0,
  Collections: 1,
  Create: 2,
  ReadItem: 3,
  Update: 4,
  Delete: 5,
} as const;

export type Phase = (typeof Phase)[keyof typeof Phase];

export const PHASE_NAMES: Record<Phase, string> = {
  [Phase.Public]: 'public and unauthenticated',
  [Phase.Collections]: 'collection reads',
  [Phase.Create]: 'creates',
  [Phase.ReadItem]: 'item reads',
  [Phase.Update]: 'updates and actions',
  [Phase.Delete]: 'deletes',
};

interface Quarantine {
  operations: Record<string, string>;
  caution: Record<string, string>;
}

export function loadQuarantine(path: string): Quarantine {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const { $comment, ...caution } = raw.caution ?? {};
  return { operations: raw.operations ?? {}, caution };
}

const PARAM = /\{([^}]+)\}/g;

function paramsOf(path: string): string[] {
  return [...path.matchAll(PARAM)].map((m) => m[1]!);
}

function isItemPath(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  return last !== undefined && last.startsWith('{');
}

function familyOf(path: string): string {
  const index = path.indexOf('/{');
  return index === -1 ? path : path.slice(0, index);
}

function depthOf(path: string): number {
  return path.split('/').filter(Boolean).length;
}

/**
 * Streaming and upgrade endpoints, which never return.
 *
 * They are covered by the SDK smoke runners, which know to stop reading; a
 * request/response probe would simply hang.
 */
function isLongLived(op: Operation): boolean {
  if (/\/(stream|ws|sse)$/.test(op.path) || /\/(stream|events)\//.test(op.path)) return true;
  if (op.path === '/api/v1/mcp' || op.path.endsWith('/bridge/poll')) return true;
  const success = op.responses['200'];
  return success?.contentType === 'text/event-stream';
}

function phaseOf(op: Operation): Phase {
  if (op.method === 'DELETE') return Phase.Delete;
  if (op.method === 'GET') {
    if (op.public) return Phase.Public;
    return paramsOf(op.path).length === 0 ? Phase.Collections : Phase.ReadItem;
  }
  //  A write on a collection creates; a write on a single item changes it.
  if (isItemPath(op.path)) return Phase.Update;
  if (op.method === 'POST') return Phase.Create;
  return Phase.Update;
}

/**
 * Find the GET whose body can be echoed back to a PUT.
 *
 * Configuration endpoints are `GET`/`PUT` pairs on the same path. Sending back
 * what the server just returned exercises the write path fully while leaving
 * production configuration exactly as it was — and if the server rejects its
 * own output, that asymmetry is worth more than any synthesised body.
 */
function echoSource(op: Operation, byPath: Map<string, Operation[]>): Operation | undefined {
  if (op.method !== 'PUT' && op.method !== 'PATCH') return undefined;
  const sibling = (byPath.get(op.path) ?? []).find((candidate) => candidate.method === 'GET');
  if (!sibling) return undefined;
  //  Only worth it when the write actually takes a body.
  return op.requestBody ? sibling : undefined;
}

function bodyStrategyOf(op: Operation, echo: Operation | undefined): BodyStrategy {
  if (!op.requestBody) return 'none';
  if (echo) return 'echo-get';
  if (op.requestBody.contentType.includes('multipart')) return 'multipart';
  return 'synth';
}

export interface Plan {
  calls: PlannedCall[];
  skipped: { op: Operation; reason: string }[];
}

export function buildPlan(spec: Spec, quarantine: Quarantine): Plan {
  const byPath = new Map<string, Operation[]>();
  for (const op of spec.operations) {
    const list = byPath.get(op.path) ?? [];
    list.push(op);
    byPath.set(op.path, list);
  }

  //  For a collection path, the parameter its children are keyed by. A create
  //  at /api/v1/agents therefore knows to register what it made as `agentId`.
  const childParam = new Map<string, string>();
  for (const path of byPath.keys()) {
    const match = /^(.*)\/\{([^}]+)\}$/.exec(path);
    if (match) childParam.set(match[1]!, match[2]!);
  }

  const calls: PlannedCall[] = [];
  const skipped: { op: Operation; reason: string }[] = [];

  for (const op of spec.operations) {
    if (isLongLived(op)) {
      skipped.push({ op, reason: 'long-lived stream; covered by the SDK smoke runners' });
      continue;
    }

    const echo = echoSource(op, byPath);
    const captured = childParam.get(op.path);
    calls.push({
      op,
      phase: phaseOf(op),
      family: familyOf(op.path),
      depth: depthOf(op.path),
      bodyStrategy: bodyStrategyOf(op, echo),
      echoFrom: echo?.id,
      needs: paramsOf(op.path),
      captures: captured && (op.method === 'POST' || op.method === 'PUT') ? [captured] : [],
      quarantined: quarantine.operations[op.id],
      caution: quarantine.caution[op.id],
    });
  }

  calls.sort((a, b) => {
    if (a.phase !== b.phase) return a.phase - b.phase;
    //  Parents before children, except when deleting: unwind deepest first.
    const depth = a.phase === Phase.Delete ? b.depth - a.depth : a.depth - b.depth;
    if (depth !== 0) return depth;
    if (a.family !== b.family) return a.family < b.family ? -1 : 1;
    return a.op.id < b.op.id ? -1 : 1;
  });

  return { calls, skipped };
}

/**
 * Pull a resource id out of a create response.
 *
 * Servers are inconsistent about this — `id`, `agent_id`, `{data:{id}}` and
 * `{agent:{id}}` all occur — so the search is deliberately broad, and the
 * parameter name being looked for is tried first.
 */
export function captureId(body: unknown, paramName: string): string | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const snake = paramName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const wanted = [paramName, snake, 'id', 'uuid', snake.replace(/_id$/, '') + '_id'];

  const fromRecord = (record: Record<string, unknown>): string | undefined => {
    for (const key of wanted) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
  };

  const direct = fromRecord(body as Record<string, unknown>);
  if (direct) return direct;

  //  One level down covers the `{data: …}` and `{agent: …}` envelopes.
  for (const value of Object.values(body as Record<string, unknown>)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = fromRecord(value as Record<string, unknown>);
      if (nested) return nested;
    }
  }
  return undefined;
}
