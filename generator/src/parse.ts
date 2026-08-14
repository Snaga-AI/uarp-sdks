/**
 * OpenAPI 3.1 -> IR.
 *
 * The UARP document describes most request/response bodies inline rather than
 * through `components.schemas`, so the bulk of the work here is *hoisting*:
 * every anonymous object/enum becomes a named IR type with a deterministic,
 * collision-free name derived from where it appeared.
 */
import {
  type AliasType,
  type BodyEncoding,
  type EnumType,
  type Group,
  type MultipartPart,
  type NamedType,
  type ObjectType,
  type Operation,
  type Pagination,
  type Param,
  type Prim,
  type Property,
  type RequestBody,
  type ResponseInfo,
  type Spec,
  type TypeRef,
} from './ir.ts';
import { camel, pascal, singular, words } from './naming.ts';

type Json = Record<string, any>;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

/** Verbs that may stand alone as a method name after the tag is stripped. */
const VERBS = new Set([
  'list', 'get', 'create', 'update', 'delete', 'patch', 'replace', 'search', 'stream',
  'cancel', 'resume', 'publish', 'invoke', 'rate', 'yank', 'share', 'upload', 'download',
  'send', 'verify', 'register', 'login', 'logout', 'export', 'import', 'sync', 'run',
]);

export const PRIM_JSON: TypeRef = { kind: 'prim', prim: 'json' };
const PRIM_JSON_OBJECT: TypeRef = { kind: 'prim', prim: 'jsonObject' };
const PRIM_STRING: TypeRef = { kind: 'prim', prim: 'string' };

export function parse(doc: Json): Spec {
  return new Parser(doc).run();
}

class Parser {
  readonly #doc: Json;
  readonly #types = new Map<string, NamedType>();
  /** structural hash -> already-registered type name, so identical shapes collapse. */
  readonly #byHash = new Map<string, string>();
  /** Component schema names currently being built, to survive recursive $refs. */
  readonly #building = new Set<string>();

  constructor(doc: Json) {
    this.#doc = doc;
  }

  run(): Spec {
    this.#registerComponentSchemas();
    const groups = this.#collectOperations();
    const info = this.#doc.info ?? {};
    return {
      title: info.title ?? 'UARP',
      version: info.version ?? '0.0.0',
      description: info.description,
      servers: (this.#doc.servers ?? []).map((s: Json) => ({ url: s.url, description: s.description })),
      types: [...this.#types.values()].sort((a, b) => a.name.localeCompare(b.name)),
      groups,
      scopes: this.#scopeCatalogue(),
    };
  }

  // ---------------------------------------------------------------- schemas

  #registerComponentSchemas(): void {
    const schemas: Json = this.#doc.components?.schemas ?? {};
    for (const name of Object.keys(schemas)) this.#componentType(name);
  }

  /** Build (once) the named type for `components.schemas.<name>`. */
  #componentType(name: string): TypeRef {
    const typeName = pascal(name);
    if (this.#types.has(typeName) || this.#building.has(typeName)) {
      return { kind: 'named', name: typeName };
    }
    const schema: Json | undefined = this.#doc.components?.schemas?.[name];
    if (!schema) return PRIM_JSON;

    this.#building.add(typeName);
    try {
      const built = this.#buildNamed(typeName, schema);
      if (built) {
        this.#types.set(typeName, built);
        this.#byHash.set(hashType(built), typeName);
        return { kind: 'named', name: typeName };
      }
      // Scalar/array component schema -> alias.
      const target = this.#schemaType(schema, typeName);
      const alias: AliasType = { kind: 'alias', name: typeName, description: schema.description, target };
      this.#types.set(typeName, alias);
      return { kind: 'named', name: typeName };
    } finally {
      this.#building.delete(typeName);
    }
  }

  /** Returns an object/enum type for `schema`, or null when it is not nameable. */
  #buildNamed(name: string, schema: Json): NamedType | null {
    const flat = this.#flattenAllOf(schema);
    if (Array.isArray(flat.enum) && flat.enum.every((v: unknown) => typeof v === 'string')) {
      return { kind: 'enum', name, description: flat.description, values: flat.enum as string[] };
    }
    if (flat.properties && Object.keys(flat.properties).length > 0) {
      return this.#buildObject(name, flat);
    }
    return null;
  }

  #buildObject(name: string, schema: Json): ObjectType {
    const required = new Set<string>(schema.required ?? []);
    const properties: Property[] = [];
    for (const [wire, raw] of Object.entries<Json>(schema.properties ?? {})) {
      const child = this.#flattenAllOf(raw);
      const { type, nullable } = this.#schemaTypeNullable(child, name + pascal(wire));
      properties.push({
        wire,
        type,
        required: required.has(wire),
        nullable,
        description: child.description,
        deprecated: child.deprecated === true,
        constValue: typeof child.const === 'string' ? child.const : undefined,
        defaultValue: child.default,
      });
    }
    return {
      kind: 'object',
      name,
      description: schema.description,
      properties,
      additional: this.#additional(schema),
    };
  }

  #additional(schema: Json): TypeRef | null {
    const ap = schema.additionalProperties;
    if (ap === undefined || ap === false) return null;
    if (ap === true) return PRIM_JSON;
    return this.#schemaType(ap, 'Value');
  }

  /** Resolve `$ref` chains and merge `allOf` members into one schema object. */
  #flattenAllOf(schema: Json): Json {
    if (!schema || typeof schema !== 'object') return {};
    if (!schema.allOf) return schema;
    const merged: Json = { type: 'object', properties: {}, required: [] as string[] };
    const extras: Json = {};
    for (const member of schema.allOf as Json[]) {
      const resolved = this.#deref(member);
      const flat = this.#flattenAllOf(resolved);
      Object.assign(merged.properties, flat.properties ?? {});
      merged.required = [...new Set([...(merged.required as string[]), ...(flat.required ?? [])])];
      if (flat.additionalProperties !== undefined) extras.additionalProperties = flat.additionalProperties;
    }
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'allOf') continue;
      if (k === 'properties') Object.assign(merged.properties, v as Json);
      else if (k === 'required') merged.required = [...new Set([...(merged.required as string[]), ...(v as string[])])];
      else merged[k] = v;
    }
    return { ...merged, ...extras };
  }

  #deref(schema: Json): Json {
    let node = schema;
    let guard = 0;
    while (node && typeof node === 'object' && typeof node.$ref === 'string' && guard++ < 16) {
      node = this.#lookupRef(node.$ref) ?? {};
    }
    return node ?? {};
  }

  #lookupRef(ref: string): Json | undefined {
    if (!ref.startsWith('#/')) return undefined;
    let node: any = this.#doc;
    for (const part of ref.slice(2).split('/')) {
      node = node?.[decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'))];
      if (node === undefined) return undefined;
    }
    return node;
  }

  #schemaType(schema: Json | undefined, hint: string): TypeRef {
    return this.#schemaTypeNullable(schema, hint).type;
  }

  /** The core schema -> TypeRef conversion, also reporting JSON-`null`ability. */
  #schemaTypeNullable(schemaIn: Json | undefined, hint: string): { type: TypeRef; nullable: boolean } {
    if (!schemaIn || typeof schemaIn !== 'object') return { type: PRIM_JSON, nullable: false };

    // A direct $ref keeps the component's identity instead of being hoisted.
    if (typeof schemaIn.$ref === 'string') {
      const m = /^#\/components\/schemas\/(.+)$/.exec(schemaIn.$ref);
      if (m) return { type: this.#componentType(m[1]!), nullable: false };
      return this.#schemaTypeNullable(this.#deref(schemaIn), hint);
    }

    const schema = this.#flattenAllOf(schemaIn);
    let nullable = schema.nullable === true;

    // 3.1 style: type may be an array that includes "null".
    let type = schema.type;
    if (Array.isArray(type)) {
      const nonNull = type.filter((t: string) => t !== 'null');
      if (nonNull.length !== type.length) nullable = true;
      type = nonNull.length === 1 ? nonNull[0] : undefined;
      if (nonNull.length > 1) {
        const variants = nonNull.map((t: string) => this.#schemaType({ ...schema, type: t }, hint));
        return { type: { kind: 'union', variants }, nullable };
      }
    }

    const composite = (schema.oneOf ?? schema.anyOf) as Json[] | undefined;
    if (composite && composite.length > 0) {
      const variants: TypeRef[] = [];
      for (const [i, member] of composite.entries()) {
        const resolved = this.#deref(member);
        if (resolved.type === 'null') {
          nullable = true;
          continue;
        }
        variants.push(this.#schemaType(member, `${hint}Variant${i + 1}`));
      }
      if (variants.length === 0) return { type: PRIM_JSON, nullable: true };
      if (variants.length === 1) return { type: variants[0]!, nullable };
      return { type: { kind: 'union', variants: dedupeRefs(variants) }, nullable };
    }

    if (Array.isArray(schema.enum) && schema.enum.every((v: unknown) => typeof v === 'string')) {
      if (schema.enum.includes('null')) nullable = nullable || type === undefined;
      return { type: this.#hoistEnum(hint, schema.enum as string[], schema.description), nullable };
    }

    switch (type) {
      case 'string':
        return { type: { kind: 'prim', prim: stringPrim(schema.format) }, nullable };
      case 'integer':
        return { type: { kind: 'prim', prim: 'integer' }, nullable };
      case 'number':
        return { type: { kind: 'prim', prim: 'number' }, nullable };
      case 'boolean':
        return { type: { kind: 'prim', prim: 'boolean' }, nullable };
      case 'array': {
        const itemHint = itemHintFor(hint);
        const items = schema.items ? this.#schemaType(schema.items, itemHint) : PRIM_JSON;
        return { type: { kind: 'array', items }, nullable };
      }
      case 'object':
      case undefined: {
        if (schema.properties && Object.keys(schema.properties).length > 0) {
          return { type: this.#hoistObject(hint, schema), nullable };
        }
        const additional = this.#additional(schema);
        if (additional && additional.kind !== 'prim') return { type: { kind: 'map', values: additional }, nullable };
        if (type === 'object') return { type: PRIM_JSON_OBJECT, nullable };
        return { type: PRIM_JSON, nullable };
      }
      case 'null':
        return { type: PRIM_JSON, nullable: true };
      default:
        return { type: PRIM_JSON, nullable };
    }
  }

  #hoistEnum(hint: string, values: string[], description?: string): TypeRef {
    const candidate: EnumType = { kind: 'enum', name: pascal(hint), description, values };
    return this.#register(candidate);
  }

  #hoistObject(hint: string, schema: Json): TypeRef {
    // Build under the provisional name so nested hoists get sensible prefixes.
    const provisional = pascal(hint);
    const built = this.#buildObject(provisional, schema);
    return this.#register(built);
  }

  /**
   * Insert a hoisted type and return a reference to it.
   *
   * Enums are deduplicated structurally — the same value set really is the same
   * type, and sharing `SortOrder` across 30 endpoints is a feature. Objects are
   * not: two unrelated `{ reason?: string }` bodies must keep their own names,
   * otherwise `agents.suspend()` ends up advertising a `SuspendTenantRequest`.
   */
  #register(type: NamedType): TypeRef {
    const hash = hashType(type);
    const existing = type.kind === 'enum' ? this.#byHash.get(hash) : undefined;
    if (existing) return { kind: 'named', name: existing };

    let name = type.name;
    if (this.#types.has(name)) {
      let n = 2;
      while (this.#types.has(`${name}${n}`)) n++;
      name = `${name}${n}`;
    }
    const stored = { ...type, name } as NamedType;
    this.#types.set(name, stored);
    this.#byHash.set(hash, name);
    return { kind: 'named', name };
  }

  // ------------------------------------------------------------- operations

  #collectOperations(): Group[] {
    const groups = new Map<string, Group>();
    const paths: Json = this.#doc.paths ?? {};

    for (const [path, item] of Object.entries<Json>(paths)) {
      const shared: Json[] = item.parameters ?? [];
      for (const method of HTTP_METHODS) {
        const raw: Json | undefined = item[method];
        if (!raw) continue;
        const op = this.#operation(path, method, raw, shared);
        const key = op.group;
        let group = groups.get(key);
        if (!group) {
          group = {
            tag: key,
            name: pascal(key),
            accessor: camel(key),
            description: this.#tagDescription(key),
            operations: [],
          };
          groups.set(key, group);
        }
        group.operations.push(op);
      }
    }

    for (const group of groups.values()) {
      resolveMethodNames(group);
      group.operations.sort((a, b) => a.method.localeCompare(b.method));
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  #tagDescription(tag: string): string | undefined {
    const found = (this.#doc.tags ?? []).find((t: Json) => t.name === tag && t.description);
    return found?.description;
  }

  #operation(path: string, httpMethod: HttpMethod, raw: Json, shared: Json[]): Operation {
    const id: string = raw.operationId ?? camel(`${httpMethod} ${path}`);
    const group: string = raw.tags?.[0] ?? 'Default';
    const opName = pascal(id);

    const pathParams: Param[] = [];
    const queryParams: Param[] = [];
    const headerParams: Param[] = [];
    const seen = new Set<string>();
    for (const p of [...shared, ...(raw.parameters ?? [])]) {
      const param = this.#deref(p);
      if (!param.name || !param.in) continue;
      const key = `${param.in}:${param.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // The transport layer owns auth and idempotency plumbing.
      if (param.in === 'header' && /^(authorization|idempotency-key)$/i.test(param.name)) continue;
      const entry: Param = {
        wire: param.name,
        location: param.in,
        required: param.required === true,
        type: this.#schemaType(param.schema, `${opName}${pascal(param.name)}`),
        description: param.description,
      };
      if (param.in === 'path') pathParams.push(entry);
      else if (param.in === 'query') queryParams.push(entry);
      else if (param.in === 'header') headerParams.push(entry);
    }

    const body = this.#requestBody(raw.requestBody, opName);
    const { response, sse, errorStatuses } = this.#response(raw.responses ?? {}, opName);
    const pagination = this.#pagination(response, queryParams);

    const scopes = new Set<string>();
    for (const requirement of (raw.security ?? this.#doc.security ?? []) as Json[]) {
      for (const list of Object.values<string[]>(requirement)) for (const s of list ?? []) scopes.add(s);
    }

    return {
      id,
      method: camel(id),
      httpMethod,
      path,
      group,
      summary: raw.summary,
      description: raw.description,
      deprecated: raw.deprecated === true,
      pathParams,
      queryParams,
      headerParams,
      body,
      response,
      errorStatuses,
      sse,
      pagination,
      scopes: [...scopes].sort(),
      idempotent: httpMethod !== 'get' && path.startsWith('/api/v1'),
    };
  }

  #requestBody(raw: Json | undefined, opName: string): RequestBody | undefined {
    if (!raw) return undefined;
    const node = this.#deref(raw);
    const content: Json | undefined = node.content;
    if (!content) return undefined;

    const pick = (ct: string): Json | undefined => content[ct];
    const json = pick('application/json') ?? pick('application/problem+json');
    const required = node.required === true;

    if (json) {
      return {
        encoding: 'json',
        type: this.#schemaType(json.schema, `${opName}Request`),
        required,
        description: node.description,
      };
    }
    const multipart = pick('multipart/form-data');
    if (multipart) {
      const schema = this.#flattenAllOf(this.#deref(multipart.schema ?? {}));
      const req = new Set<string>(schema.required ?? []);
      const parts: MultipartPart[] = Object.entries<Json>(schema.properties ?? {}).map(([wire, prop]) => ({
        wire,
        required: req.has(wire),
        role: prop.format === 'binary' || prop.type === 'file' ? 'file' : 'field',
        description: prop.description,
      }));
      return {
        encoding: 'multipart',
        type: this.#schemaType(multipart.schema, `${opName}Request`),
        required,
        description: node.description,
        parts,
      };
    }
    const form = pick('application/x-www-form-urlencoded');
    if (form) {
      return {
        encoding: 'form',
        type: this.#schemaType(form.schema, `${opName}Request`),
        required,
        description: node.description,
      };
    }
    const binary = pick('application/octet-stream');
    if (binary) {
      return { encoding: 'binary', type: { kind: 'prim', prim: 'binary' }, required, description: node.description };
    }
    const text = pick('text/plain');
    if (text) return { encoding: 'text', type: PRIM_STRING, required, description: node.description };

    // Unknown media type: send raw JSON rather than dropping the body entirely.
    const first = Object.values<Json>(content)[0];
    return {
      encoding: 'json' as BodyEncoding,
      type: this.#schemaType(first?.schema, `${opName}Request`),
      required,
      description: node.description,
    };
  }

  #response(responses: Json, opName: string): { response: ResponseInfo; sse: boolean; errorStatuses: number[] } {
    const codes = Object.keys(responses)
      .map((c) => Number.parseInt(c, 10))
      .filter((n) => Number.isFinite(n));
    const success = codes.filter((c) => c >= 200 && c < 400).sort((a, b) => a - b);
    const errorStatuses = codes.filter((c) => c >= 400).sort((a, b) => a - b);
    const status = success[0] ?? 200;
    const node = this.#deref(responses[String(status)] ?? {});
    const content: Json | undefined = node.content;

    if (!content) {
      // `204 No Content` really is empty; anything else just failed to document
      // its body, and returning raw JSON beats throwing the payload away.
      const type = status === 204 || status === 205 || status === 304 ? undefined : PRIM_JSON;
      return { response: { status, type, description: node.description }, sse: false, errorStatuses };
    }
    if (content['text/event-stream']) {
      return { response: { status, type: PRIM_JSON, description: node.description }, sse: true, errorStatuses };
    }
    const json = content['application/json'];
    if (json) {
      return {
        response: { status, type: this.#schemaType(json.schema, `${opName}Response`), description: node.description },
        sse: false,
        errorStatuses,
      };
    }
    if (content['application/octet-stream'] || content['application/pdf'] || content['image/png']) {
      return {
        response: { status, type: { kind: 'prim', prim: 'binary' }, description: node.description },
        sse: false,
        errorStatuses,
      };
    }
    if (content['text/plain'] || content['text/csv'] || content['text/html']) {
      return { response: { status, type: PRIM_STRING, description: node.description }, sse: false, errorStatuses };
    }
    return { response: { status, description: node.description }, sse: false, errorStatuses };
  }

  /** Detect the `{ <items>, cursor, has_more }` envelope so emitters can auto-paginate. */
  #pagination(response: ResponseInfo, queryParams: Param[]): Pagination | undefined {
    if (!response.type || response.type.kind !== 'named') return undefined;
    const cursorParam = queryParams.find((p) => p.wire === 'cursor');
    if (!cursorParam) return undefined;
    const type = this.#types.get(response.type.name);
    if (!type || type.kind !== 'object') return undefined;
    const cursorProp = type.properties.find((p) => p.wire === 'cursor');
    if (!cursorProp) return undefined;
    const arrays = type.properties.filter((p) => p.type.kind === 'array');
    const itemsProp = arrays.find((p) => p.wire === 'items') ?? (arrays.length === 1 ? arrays[0] : undefined);
    if (!itemsProp || itemsProp.type.kind !== 'array') return undefined;
    const hasMore = type.properties.find((p) => p.wire === 'has_more');
    return {
      itemsProp: itemsProp.wire,
      itemType: itemsProp.type.items,
      itemsOptional: !itemsProp.required || itemsProp.nullable,
      cursorProp: cursorProp.wire,
      cursorOptional: !cursorProp.required || cursorProp.nullable,
      hasMoreProp: hasMore?.wire,
      hasMoreOptional: hasMore ? !hasMore.required || hasMore.nullable : true,
      cursorParam: 'cursor',
      limitParam: queryParams.find((p) => p.wire === 'limit')?.wire,
    };
  }

  #scopeCatalogue(): string[] {
    const scopes = new Set<string>();
    for (const item of Object.values<Json>(this.#doc.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        for (const req of (item[method]?.security ?? []) as Json[]) {
          for (const list of Object.values<string[]>(req)) for (const s of list ?? []) scopes.add(s);
        }
      }
    }
    return [...scopes].sort();
  }
}

// ------------------------------------------------------------------ helpers

function stringPrim(format: unknown): Prim {
  switch (format) {
    case 'date-time':
      return 'datetime';
    case 'date':
      return 'date';
    case 'uuid':
      return 'uuid';
    case 'uri':
    case 'url':
      return 'uri';
    case 'email':
      return 'email';
    case 'binary':
    case 'byte':
      return 'binary';
    default:
      return 'string';
  }
}

/** `ListAgentsResponseItems` -> `ListAgentsResponseItem`. */
function itemHintFor(hint: string): string {
  const parts = words(hint);
  const last = parts[parts.length - 1];
  if (!last) return hint + 'Item';
  const sing = singular(last);
  if (sing !== last) return pascal([...parts.slice(0, -1), sing].join(' '));
  return hint + 'Item';
}

function dedupeRefs(refs: TypeRef[]): TypeRef[] {
  const seen = new Set<string>();
  const out: TypeRef[] = [];
  for (const r of refs) {
    const key = JSON.stringify(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Structural fingerprint used to collapse identical hoisted types. */
function hashType(type: NamedType): string {
  if (type.kind === 'enum') return `enum:${type.values.join('|')}`;
  if (type.kind === 'alias') return `alias:${JSON.stringify(type.target)}`;
  const props = type.properties
    .map((p) => `${p.wire}:${JSON.stringify(p.type)}:${p.required ? 1 : 0}${p.nullable ? 'n' : ''}`)
    .sort()
    .join(',');
  return `object:${props}:${JSON.stringify(type.additional)}`;
}

/**
 * Shorten `listAgents` to `list` inside the `Agents` group, but only when the
 * remainder is a single verb — `listAgentRuns` must stay as it is.
 */
function resolveMethodNames(group: Group): void {
  const tagWords = words(group.tag);
  const tagVariants = [tagWords, tagWords.map((w, i) => (i === tagWords.length - 1 ? singular(w) : w))];

  const preferred = new Map<string, string>();
  for (const op of group.operations) {
    const opWords = words(op.id);
    let short: string | undefined;
    for (const variant of tagVariants) {
      if (opWords.length <= variant.length) continue;
      const tail = opWords.slice(-variant.length);
      if (tail.join(' ') !== variant.join(' ')) continue;
      const rest = opWords.slice(0, -variant.length);
      if (rest.length === 1 && VERBS.has(rest[0]!)) short = rest[0]!;
    }
    preferred.set(op.id, short ? camel(short) : camel(op.id));
  }

  const counts = new Map<string, number>();
  for (const name of preferred.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const op of group.operations) {
    const name = preferred.get(op.id)!;
    op.method = (counts.get(name) ?? 0) > 1 ? camel(op.id) : name;
  }
}
