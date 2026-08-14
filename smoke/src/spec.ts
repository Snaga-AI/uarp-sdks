/**
 * Spec access for the live probe.
 *
 * The generator turns the spec into an IR and smooths over the awkward parts;
 * the probe must not. Its whole job is to report where the document and the
 * server disagree, so it reads the document as written and resolves `$ref` on
 * demand.
 */
import { readFileSync } from 'node:fs';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = boolean | Record<string, any>;

export interface Operation {
  id: string;
  method: string;
  path: string;
  summary?: string;
  tags: string[];
  parameters: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, ResponseSpec>;
  /** Scopes the document says this call needs; `[]` means it is public. */
  scopes: string[];
  /** True when the operation opts out of the document-level security. */
  public: boolean;
}

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  schema: Schema;
  example?: Json;
}

export interface RequestBody {
  required: boolean;
  contentType: string;
  schema: Schema;
  example?: Json;
}

export interface ResponseSpec {
  status: string;
  contentType?: string;
  schema?: Schema;
}

export interface Spec {
  raw: Record<string, any>;
  title: string;
  version: string;
  servers: string[];
  operations: Operation[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/** Resolve a local `$ref`. Remote refs are not used by this document. */
export function resolveRef(raw: Record<string, any>, ref: string): any {
  if (!ref.startsWith('#/')) throw new Error(`only local refs are supported: ${ref}`);
  let node: any = raw;
  for (const rawPart of ref.slice(2).split('/')) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === undefined || node === null) throw new Error(`unresolvable ref: ${ref}`);
    node = node[part];
  }
  if (node === undefined) throw new Error(`unresolvable ref: ${ref}`);
  return node;
}

/**
 * Follow a chain of `$ref`s to the first node that is not itself a reference.
 *
 * Returns the name of the last component schema passed through, so callers can
 * record which models the server actually exercised.
 */
export function deref(
  raw: Record<string, any>,
  schema: Schema,
): { schema: Schema; name?: string } {
  let current = schema;
  let name: string | undefined;
  for (let hop = 0; hop < 32; hop++) {
    if (typeof current === 'boolean' || !current || typeof current.$ref !== 'string') {
      return { schema: current, name };
    }
    const match = /^#\/components\/schemas\/(.+)$/.exec(current.$ref);
    if (match) name = decodeURIComponent(match[1]!);
    current = resolveRef(raw, current.$ref);
  }
  throw new Error('$ref chain too deep');
}

function collectScopes(op: Record<string, any>, documentSecurity: any): { scopes: string[]; isPublic: boolean } {
  const security = op.security ?? documentSecurity ?? [];
  if (Array.isArray(security) && security.length === 0) return { scopes: [], isPublic: true };
  const scopes = new Set<string>();
  for (const requirement of security) {
    for (const list of Object.values(requirement as Record<string, string[]>)) {
      for (const scope of list) scopes.add(scope);
    }
  }
  return { scopes: [...scopes].sort(), isPublic: false };
}

/**
 * Pick the body encoding the probe will use.
 *
 * JSON when offered, because that is what the SDKs send; multipart otherwise so
 * the upload paths are still covered.
 */
function pickBody(content: Record<string, any>, required: boolean): RequestBody | undefined {
  const types = Object.keys(content);
  if (types.length === 0) return undefined;
  const contentType =
    types.find((t) => t.includes('json')) ?? types.find((t) => t.includes('multipart')) ?? types[0]!;
  const media = content[contentType] ?? {};
  return { required, contentType, schema: media.schema ?? true, example: media.example };
}

function pickResponses(responses: Record<string, any>): Record<string, ResponseSpec> {
  const out: Record<string, ResponseSpec> = {};
  for (const [status, node] of Object.entries(responses ?? {})) {
    const content = (node as any)?.content ?? {};
    const contentType = Object.keys(content).find((t) => t.includes('json')) ?? Object.keys(content)[0];
    out[status] = {
      status,
      contentType,
      schema: contentType ? content[contentType]?.schema : undefined,
    };
  }
  return out;
}

export function loadSpec(path: string): Spec {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
  const operations: Operation[] = [];

  for (const [pathname, item] of Object.entries(raw.paths ?? {})) {
    const shared = ((item as any).parameters ?? []) as any[];
    for (const method of METHODS) {
      const op = (item as any)[method];
      if (!op) continue;

      const parameters: Parameter[] = [...shared, ...(op.parameters ?? [])].map((p: any) => {
        const resolved = p.$ref ? resolveRef(raw, p.$ref) : p;
        return {
          name: resolved.name,
          in: resolved.in,
          required: resolved.required === true || resolved.in === 'path',
          schema: resolved.schema ?? true,
          example: resolved.example,
        };
      });

      const { scopes, isPublic } = collectScopes(op, raw.security);
      operations.push({
        id: op.operationId ?? `${method}${pathname.replace(/[^A-Za-z0-9]+/g, '_')}`,
        method: method.toUpperCase(),
        path: pathname,
        summary: op.summary,
        tags: op.tags ?? [],
        parameters,
        requestBody: op.requestBody
          ? pickBody(
              (op.requestBody.$ref ? resolveRef(raw, op.requestBody.$ref) : op.requestBody).content ?? {},
              (op.requestBody.required ?? false) === true,
            )
          : undefined,
        responses: pickResponses(op.responses),
        scopes,
        public: isPublic,
      });
    }
  }

  return {
    raw,
    title: raw.info?.title ?? 'unknown',
    version: raw.info?.version ?? '0',
    servers: (raw.servers ?? []).map((s: any) => s.url),
    operations,
  };
}

/** The 2xx response the probe expects, preferring the most specific one. */
export function successResponse(op: Operation): ResponseSpec | undefined {
  const codes = Object.keys(op.responses).filter((c) => /^2\d\d$/.test(c));
  if (codes.length > 0) return op.responses[codes.sort()[0]!];
  return op.responses['2XX'] ?? op.responses.default;
}

/** Every status the document documents, expanded from wildcard forms. */
export function documentedStatuses(op: Operation): string[] {
  return Object.keys(op.responses).filter((c) => /^\d\d\d$/.test(c));
}
