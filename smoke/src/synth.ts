/**
 * Build request payloads from the document alone.
 *
 * The rule here is deliberate and is what makes the run useful: the probe sends
 * *exactly what the schema says is enough* — every required property, nothing
 * more. If the server then rejects the call, one of two things is true, and
 * both belong in the backend report:
 *
 *   - the endpoint enforces a constraint the schema never mentions, or
 *   - the schema marks something optional that is really required.
 *
 * Filling in every optional property too would hide both.
 */
import { deref, type Parameter, type Schema } from './spec.ts';

export interface SynthContext {
  spec: Record<string, any>;
  /** Tags everything this run creates, so leftovers are identifiable. */
  runId: string;
  /** Ids captured from earlier creates, keyed by path-parameter name. */
  ids: Map<string, string>;
}

const MAX_DEPTH = 6;

export function uuid(): string {
  return crypto.randomUUID();
}

function nameHints(name: string): string | undefined {
  const n = name.toLowerCase();
  if (/mail/.test(n)) return 'email';
  if (/(^|_)(url|uri|endpoint|callback|webhook|href|link)(_|$)/.test(n)) return 'url';
  if (/(^|_)(slug)(_|$)/.test(n)) return 'slug';
  if (/(^|_)(colour|color)(_|$)/.test(n)) return 'colour';
  if (/(^|_)(version)(_|$)/.test(n)) return 'version';
  if (/(^|_)(model|model_ref)(_|$)/.test(n)) return 'model';
  if (/(^|_)(provider)(_|$)/.test(n)) return 'provider';
  if (/(^|_)(id|ids)(_|$)|_id$/.test(n)) return 'id';
  if (/(name|title|label|description|summary|content|text|message|prompt|reason|note)/.test(n)) return 'prose';
  return undefined;
}

function stringFor(ctx: SynthContext, name: string, node: Record<string, any>): string {
  const label = `smoke-${ctx.runId}`;

  if (Array.isArray(node.enum) && node.enum.length > 0) return String(node.enum[0]);
  if (typeof node.const === 'string') return node.const;
  if (typeof node.default === 'string') return node.default;
  if (typeof node.example === 'string') return node.example;

  const now = new Date();
  switch (node.format) {
    case 'uuid':
      return uuid();
    case 'date-time':
      return now.toISOString();
    case 'date':
      return now.toISOString().slice(0, 10);
    case 'email':
      return `${label}@example.com`;
    case 'uri':
    case 'url':
      return `https://example.com/${label}`;
    case 'binary':
      return label;
    default:
      break;
  }

  let value: string;
  switch (nameHints(name)) {
    case 'email':
      value = `${label}@example.com`;
      break;
    case 'url':
      value = `https://example.com/${label}`;
      break;
    case 'slug':
      value = label;
      break;
    case 'colour':
      value = '#336699';
      break;
    case 'version':
      value = '1.0.0';
      break;
    case 'model':
      value = 'gpt-4o-mini';
      break;
    case 'provider':
      value = 'openai_compat';
      break;
    case 'id':
      value = ctx.ids.get(name) ?? uuid();
      break;
    case 'prose':
      value = `${label} probe`;
      break;
    default:
      value = label;
  }

  //  A documented pattern wins over the guess: sending something that plainly
  //  violates it would produce a 400 that says nothing about the backend.
  if (typeof node.pattern === 'string') {
    try {
      const pattern = new RegExp(node.pattern);
      if (!pattern.test(value)) {
        const literal = literalFromPattern(node.pattern);
        if (literal && pattern.test(literal)) value = literal;
      }
    } catch {
      //  An unparseable pattern is a finding in itself; the caller records it.
    }
  }

  const min = typeof node.minLength === 'number' ? node.minLength : 0;
  const max = typeof node.maxLength === 'number' ? node.maxLength : Infinity;
  if (value.length < min) value = value.padEnd(min, 'x');
  if (value.length > max) value = value.slice(0, max);
  return value;
}

/** Best-effort literal for a simple anchored pattern such as `^[a-z]+$`. */
function literalFromPattern(pattern: string): string | undefined {
  const plain = pattern.replace(/^\^/, '').replace(/\$$/, '');
  if (/^[A-Za-z0-9_-]+$/.test(plain)) return plain;
  return undefined;
}

function numberFor(node: Record<string, any>, integer: boolean): number {
  if (typeof node.default === 'number') return node.default;
  if (typeof node.example === 'number') return node.example;
  if (Array.isArray(node.enum) && node.enum.length > 0) return Number(node.enum[0]);
  let value = 1;
  if (typeof node.minimum === 'number') value = Math.max(value, node.minimum);
  if (typeof node.exclusiveMinimum === 'number') value = Math.max(value, node.exclusiveMinimum + 1);
  if (typeof node.maximum === 'number') value = Math.min(value, node.maximum);
  return integer ? Math.round(value) : value;
}

/** Merge the branches of an `allOf` so required lists and properties combine. */
function flatten(ctx: SynthContext, schema: Schema, depth: number): Record<string, any> {
  const { schema: node } = deref(ctx.spec, schema);
  if (typeof node !== 'object' || node === null) return {};
  if (!Array.isArray(node.allOf)) return node;

  const merged: Record<string, any> = { ...node, properties: { ...(node.properties ?? {}) }, required: [...(node.required ?? [])] };
  delete merged.allOf;
  for (const branch of node.allOf) {
    const flat = flatten(ctx, branch, depth + 1);
    merged.type ??= flat.type;
    Object.assign(merged.properties, flat.properties ?? {});
    merged.required.push(...(flat.required ?? []));
    for (const key of ['enum', 'format', 'pattern', 'items', 'additionalProperties'] as const) {
      merged[key] ??= flat[key];
    }
  }
  merged.required = [...new Set(merged.required)];
  return merged;
}

/**
 * A value that satisfies `schema`.
 *
 * `required` says whether the caller must produce something at all: optional
 * array and object properties are left empty, required ones are populated, so
 * the payload stays the documented minimum.
 */
export function synthValue(
  ctx: SynthContext,
  schema: Schema,
  name = '',
  depth = 0,
  required = true,
): unknown {
  if (schema === false) return null;
  if (schema === true || schema === undefined) return `smoke-${ctx.runId}`;

  const node = flatten(ctx, schema, depth);
  if (depth > MAX_DEPTH) return minimal(node);

  if (node.example !== undefined) return node.example;
  if (node.default !== undefined) return node.default;
  if (node.const !== undefined) return node.const;

  const variants: Schema[] | undefined = node.oneOf ?? node.anyOf;
  if (Array.isArray(variants) && variants.length > 0) {
    return synthValue(ctx, variants[0]!, name, depth + 1, required);
  }

  const declared: string[] = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
  const type = declared.find((t) => t !== 'null') ?? inferType(node);

  switch (type) {
    case 'string':
      return stringFor(ctx, name, node);
    case 'integer':
      return numberFor(node, true);
    case 'number':
      return numberFor(node, false);
    case 'boolean':
      return false;
    case 'array': {
      const count = Math.max(node.minItems ?? 0, required ? 1 : 0);
      if (count === 0 || !node.items) return [];
      return Array.from({ length: count }, () => synthValue(ctx, node.items, singular(name), depth + 1, true));
    }
    case 'object': {
      const out: Record<string, unknown> = {};
      const properties: Record<string, Schema> = node.properties ?? {};
      for (const key of node.required ?? []) {
        if (properties[key] !== undefined) {
          out[key] = synthValue(ctx, properties[key]!, key, depth + 1, true);
        } else {
          out[key] = `smoke-${ctx.runId}`;
        }
      }
      //  A free-form object with nothing required still has to be non-empty for
      //  some endpoints; an empty object is the documented minimum, so send it.
      return out;
    }
    default:
      return `smoke-${ctx.runId}`;
  }
}

function inferType(node: Record<string, any>): string {
  if (node.properties || node.additionalProperties || node.required) return 'object';
  if (node.items) return 'array';
  if (node.enum) return typeof node.enum[0];
  return 'string';
}

function minimal(node: Record<string, any>): unknown {
  const declared: string[] = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
  const type = declared.find((t) => t !== 'null') ?? 'string';
  if (type === 'object') return {};
  if (type === 'array') return [];
  if (type === 'integer' || type === 'number') return 1;
  if (type === 'boolean') return false;
  return 'smoke';
}

function singular(name: string): string {
  return name.replace(/ies$/, 'y').replace(/([^s])s$/, '$1');
}

/**
 * A value for one path, query or header parameter.
 *
 * Path parameters prefer an id this run created: pointing a `DELETE` at a
 * resource the probe did not make would destroy the tenant's real data.
 */
export function synthParameter(ctx: SynthContext, parameter: Parameter): string | undefined {
  if (parameter.in === 'path') {
    const captured = ctx.ids.get(parameter.name);
    if (captured) return captured;
  }
  if (parameter.example !== undefined) return String(parameter.example);

  const { schema: node } = deref(ctx.spec, parameter.schema);
  if (typeof node === 'object' && node !== null) {
    //  Keep list responses small: this run makes hundreds of calls.
    if (parameter.name === 'limit') return String(Math.min(Number(node.maximum ?? 5), 5) || 5);
    const value = synthValue(ctx, parameter.schema, parameter.name, 0, true);
    if (value === null || typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
  return `smoke-${ctx.runId}`;
}
