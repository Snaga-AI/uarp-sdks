/**
 * Compare a live response against the schema the document promises.
 *
 * The severities are chosen from the point of view of the five SDKs, not from
 * JSON Schema's:
 *
 *   breaking — a strict decoder (Rust, Swift, Kotlin) throws on this. It is a
 *              bug that reaches users.
 *   warning  — the SDKs survive it by design, but the document is wrong and the
 *              next person to read it will be misled.
 *   info     — worth telling the backend, harmless to callers.
 */
import { deref, type Schema } from './spec.ts';

export type Severity = 'breaking' | 'warning' | 'info';

export type DivergenceKind =
  | 'missing-required'
  | 'type-mismatch'
  | 'null-not-allowed'
  | 'no-variant-matched'
  | 'unknown-enum'
  | 'const-mismatch'
  | 'undocumented-property'
  | 'format-mismatch'
  | 'precision-loss'
  | 'schema-forbids-everything';

export interface Divergence {
  kind: DivergenceKind;
  severity: Severity;
  /** JSON Pointer into the response body. */
  pointer: string;
  detail: string;
}

const SEVERITY: Record<DivergenceKind, Severity> = {
  'missing-required': 'breaking',
  'type-mismatch': 'breaking',
  'null-not-allowed': 'breaking',
  'no-variant-matched': 'breaking',
  'schema-forbids-everything': 'breaking',
  'unknown-enum': 'warning',
  'const-mismatch': 'warning',
  'precision-loss': 'warning',
  'undocumented-property': 'info',
  'format-mismatch': 'info',
};

interface Context {
  spec: Record<string, any>;
  coverage: Set<string>;
  /** Stops a pathological response from producing thousands of lines. */
  budget: number;
}

const MAX_DIVERGENCES = 60;

function make(kind: DivergenceKind, pointer: string, detail: string): Divergence {
  return { kind, severity: SEVERITY[kind], pointer, detail };
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  //  An integer is a number; the reverse is not true.
  return expected === 'number' && actual === 'integer';
}

function shortValue(value: unknown): string {
  const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

const FORMATS: Record<string, RegExp> = {
  'date-time': /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/,
  date: /^\d{4}-\d\d-\d\d$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  uri: /^[a-zA-Z][a-zA-Z0-9+.-]*:/,
};

function walk(ctx: Context, value: unknown, schema: Schema, pointer: string): Divergence[] {
  if (ctx.budget <= 0) return [];

  const { schema: node, name } = deref(ctx.spec, schema);
  if (name && value !== null && value !== undefined) ctx.coverage.add(name);

  if (node === true || node === undefined || node === null) return [];
  if (node === false) {
    return [make('schema-forbids-everything', pointer, 'the schema is `false`, so no value is valid')];
  }
  if (typeof node !== 'object') return [];

  const out: Divergence[] = [];
  const push = (d: Divergence): void => {
    if (ctx.budget-- > 0) out.push(d);
  };

  //  Composition first: the keywords below apply to whatever survives it.
  for (const sub of node.allOf ?? []) out.push(...walk(ctx, value, sub, pointer));

  for (const key of ['oneOf', 'anyOf'] as const) {
    const variants: Schema[] = node[key] ?? [];
    if (variants.length === 0) continue;
    let best: { issues: Divergence[]; coverage: Set<string> } | undefined;
    for (const variant of variants) {
      const branch: Context = { spec: ctx.spec, coverage: new Set(), budget: 12 };
      const issues = walk(branch, value, variant, pointer);
      if (!best || issues.length < best.issues.length) best = { issues, coverage: branch.coverage };
      if (issues.length === 0) break;
    }
    if (best && best.issues.length > 0) {
      push(
        make(
          'no-variant-matched',
          pointer,
          `no ${key} variant accepts ${shortValue(value)}; closest complaint: ${best.issues[0]!.detail}`,
        ),
      );
    } else if (best) {
      //  Only the variant that actually matched counts as exercised.
      for (const seen of best.coverage) ctx.coverage.add(seen);
    }
  }

  const actual = typeName(value);
  const declared: string[] = node.type === undefined ? [] : Array.isArray(node.type) ? node.type : [node.type];
  const nullable = node.nullable === true || declared.includes('null');

  if (value === null) {
    //  A schema with no `type` says nothing, so null is only wrong when the
    //  document actually claimed a type and did not include null.
    if (declared.length > 0 && !nullable) {
      push(make('null-not-allowed', pointer, `null, but the document says ${declared.join(' | ')}`));
    }
    return out;
  }

  if (declared.length > 0 && !declared.some((t) => typeMatches(t, actual))) {
    push(make('type-mismatch', pointer, `server sent ${actual} (${shortValue(value)}), document says ${declared.join(' | ')}`));
    return out;
  }

  if (Array.isArray(node.enum) && !node.enum.some((allowed: unknown) => deepEqual(allowed, value))) {
    push(make('unknown-enum', pointer, `${shortValue(value)} is not in the documented set [${node.enum.map(shortValue).join(', ')}]`));
  }

  if ('const' in node && !deepEqual(node.const, value)) {
    push(make('const-mismatch', pointer, `${shortValue(value)}, document says ${shortValue(node.const)}`));
  }

  if (typeof value === 'string' && typeof node.format === 'string') {
    const pattern = FORMATS[node.format];
    if (pattern && !pattern.test(value)) {
      push(make('format-mismatch', pointer, `${shortValue(value)} is not a valid ${node.format}`));
    }
  }

  if (Array.isArray(value)) {
    const items = node.items ?? node.prefixItems;
    if (items && !Array.isArray(items)) {
      for (const [index, item] of value.entries()) {
        out.push(...walk(ctx, item, items, `${pointer}/${index}`));
        if (ctx.budget <= 0) break;
      }
    }
    return out;
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const properties: Record<string, Schema> = node.properties ?? {};

    for (const required of node.required ?? []) {
      if (!(required in record)) {
        push(make('missing-required', `${pointer}/${required}`, 'the document marks this property required, the server omitted it'));
      }
    }

    for (const [key, item] of Object.entries(record)) {
      const child = `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (key in properties) {
        out.push(...walk(ctx, item, properties[key]!, child));
      } else if (node.additionalProperties && node.additionalProperties !== true) {
        out.push(...walk(ctx, item, node.additionalProperties, child));
      } else if (
        Object.keys(properties).length > 0 &&
        node.additionalProperties === undefined &&
        !matchesPatternProperty(node, key)
      ) {
        push(make('undocumented-property', child, `the server sends this, the document does not describe it (${typeName(item)})`));
      }
      if (ctx.budget <= 0) break;
    }
  }

  return out;
}

function matchesPatternProperty(node: Record<string, any>, key: string): boolean {
  for (const pattern of Object.keys(node.patternProperties ?? {})) {
    try {
      if (new RegExp(pattern).test(key)) return true;
    } catch {
      //  An unparseable pattern is the document's problem, not the probe's.
    }
  }
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ValidationResult {
  divergences: Divergence[];
  /** Component schema names the payload actually exercised. */
  covered: string[];
  truncated: boolean;
}

export function validateResponse(
  spec: Record<string, any>,
  value: unknown,
  schema: Schema | undefined,
): ValidationResult {
  if (schema === undefined) return { divergences: [], covered: [], truncated: false };
  const ctx: Context = { spec, coverage: new Set(), budget: MAX_DIVERGENCES };
  const divergences = walk(ctx, value, schema, '');
  return { divergences, covered: [...ctx.coverage].sort(), truncated: ctx.budget <= 0 };
}

/**
 * Integers a JSON parser cannot round-trip.
 *
 * Detected on the raw text: by the time `JSON.parse` has run the digits are
 * already gone, and this is exactly the difference the TypeScript SDK records.
 */
export function scanPrecision(rawBody: string): Divergence[] {
  const out: Divergence[] = [];
  const seen = new Set<string>();
  for (const match of rawBody.matchAll(/(?:^|[[,:{\s])(-?\d{16,})(?=[,\]}\s]|$)/g)) {
    const literal = match[1]!;
    if (seen.has(literal)) continue;
    seen.add(literal);
    if (Math.abs(Number(literal)) > Number.MAX_SAFE_INTEGER) {
      out.push(make('precision-loss', '', `${literal} exceeds 2^53, so JavaScript and Ada cannot round-trip it`));
    }
    if (out.length >= 5) break;
  }
  return out;
}
