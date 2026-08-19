/**
 * Language-neutral intermediate representation of the UARP OpenAPI document.
 *
 * Every emitter consumes this and nothing else: no emitter is allowed to reach
 * back into the raw OpenAPI JSON. That keeps the "what the API looks like"
 * decisions (hoisting, naming, nullability, pagination detection) in one place.
 */

/** Scalar leaves. `json` is an arbitrary JSON value, `jsonObject` an untyped object. */
export type Prim =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'date'
  | 'uuid'
  | 'uri'
  | 'email'
  | 'binary'
  | 'json'
  | 'jsonObject';

export type TypeRef =
  | { kind: 'prim'; prim: Prim }
  | { kind: 'named'; name: string }
  | { kind: 'array'; items: TypeRef }
  | { kind: 'map'; values: TypeRef }
  /** oneOf/anyOf. Emitters without native sum types fall back to `json`. */
  | { kind: 'union'; variants: TypeRef[] };

export interface Property {
  /** Wire name exactly as it appears in JSON. */
  wire: string;
  type: TypeRef;
  required: boolean;
  nullable: boolean;
  description?: string;
  deprecated?: boolean;
  /** `const` string values, rendered as literal types where the language allows. */
  constValue?: string;
  defaultValue?: unknown;
}

export interface ObjectType {
  kind: 'object';
  name: string;
  description?: string;
  properties: Property[];
  /** Type of additional (free-form) properties, or null when none are allowed. */
  additional: TypeRef | null;
}

export interface EnumType {
  kind: 'enum';
  name: string;
  description?: string;
  values: string[];
}

export interface AliasType {
  kind: 'alias';
  name: string;
  description?: string;
  target: TypeRef;
}

export type NamedType = ObjectType | EnumType | AliasType;

export interface Param {
  /** Wire name (`agentId`, `Last-Event-ID`, ...). */
  wire: string;
  location: 'path' | 'query' | 'header';
  required: boolean;
  type: TypeRef;
  description?: string;
}

export type BodyEncoding = 'json' | 'multipart' | 'binary' | 'form' | 'text';

export interface RequestBody {
  encoding: BodyEncoding;
  type: TypeRef;
  required: boolean;
  description?: string;
  /** For multipart: the individual parts, so emitters can build a form. */
  parts?: MultipartPart[];
}

export interface MultipartPart {
  wire: string;
  required: boolean;
  /** `file` parts carry bytes + filename; `field` parts are stringified. */
  role: 'file' | 'field';
  description?: string;
}

export interface ResponseInfo {
  status: number;
  /** undefined for 204/no-content responses. */
  type?: TypeRef;
  /**
   * How the payload is carried, which `type` alone cannot say. A `string`
   * reaches here from two different places — a JSON schema of `{"type":
   * "string"}`, whose body must still be parsed, and a text media type, whose
   * body must not be. Deciding by type alone gets one of them wrong: parsing a
   * JSONL export succeeds whenever it happens to hold exactly one line, and
   * then returns an object from a method declared to return a string.
   */
  encoding?: 'json' | 'text' | 'binary';
  description?: string;
}

/** Cursor pagination, detected from the `{ <items>, cursor, has_more }` envelope. */
export interface Pagination {
  /** Property on the response holding the page items. */
  itemsProp: string;
  itemType: TypeRef;
  /** True when the items array is optional/nullable on the response type. */
  itemsOptional: boolean;
  cursorProp: string;
  cursorOptional: boolean;
  hasMoreProp?: string;
  hasMoreOptional: boolean;
  /** Query parameter used to request the next page. */
  cursorParam: string;
  limitParam?: string;
}

export interface Operation {
  id: string;
  /** camelCase method name inside its resource group. */
  method: string;
  httpMethod: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  group: string;
  summary?: string;
  description?: string;
  deprecated: boolean;
  pathParams: Param[];
  queryParams: Param[];
  headerParams: Param[];
  body?: RequestBody;
  response: ResponseInfo;
  /** Non-2xx documented statuses, used for doc comments. */
  errorStatuses: number[];
  /** Set when the endpoint returns `text/event-stream`. */
  sse: boolean;
  pagination?: Pagination;
  /** OAuth-ish scope names required by `bearerAuth`. */
  scopes: string[];
  /** True when the endpoint accepts an `Idempotency-Key` header. */
  idempotent: boolean;
}

/**
 * Bodies the emitters know how to render. Anything else must stop the build:
 * silently sending a form body as JSON would be a wire-format bug nobody sees
 * until the server rejects it.
 */
export function assertSupportedBody(op: Operation, supported: BodyEncoding[]): void {
  if (!op.body) return;
  if (supported.includes(op.body.encoding)) return;
  throw new Error(
    `${op.id}: request bodies encoded as '${op.body.encoding}' are not supported yet. ` +
      'Add support to the emitter rather than letting it fall back to JSON.',
  );
}

export interface Group {
  /** Original OpenAPI tag. */
  tag: string;
  /** PascalCase identifier, e.g. `AdminConfig`. */
  name: string;
  /** camelCase accessor on the client, e.g. `adminConfig`. */
  accessor: string;
  description?: string;
  operations: Operation[];
}

export interface Server {
  url: string;
  description?: string;
}

export interface Spec {
  title: string;
  version: string;
  description?: string;
  servers: Server[];
  types: NamedType[];
  groups: Group[];
  /** Every scope named by the security scheme, for docs. */
  scopes: string[];
}
