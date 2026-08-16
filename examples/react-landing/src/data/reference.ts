/**
 * Lazy access to the generated reference.
 *
 * `public/reference.json` is built at build time from the generated TS sources
 * (see `scripts/gen-reference.ts`) and fetched on demand, so the ~230 KB landing
 * bundle never carries the 571-method reference. The fetch is cached; the
 * MiniSearch index is built from the same payload, also lazily, so the search
 * chunk only loads when someone actually types.
 */

export interface FieldInfo {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
  default?: string;
  deprecated?: boolean;
}

export interface ParamInfo {
  name: string;
  type: string;
  optional: boolean;
}

export interface MethodInfo {
  name: string;
  signature: string;
  summary: string;
  description?: string;
  httpMethod?: string;
  path?: string;
  scopes: string[];
  sse: boolean;
  deprecated: boolean;
  paginated: boolean;
  params: ParamInfo[];
  pathParams: ParamInfo[];
  queryParams: FieldInfo[];
  bodyType?: string;
  hasOptions: boolean;
  returnType: string;
  returnKind: 'promise' | 'iterator' | 'sse';
}

export interface GroupInfo {
  accessor: string;
  className: string;
  description: string;
  methods: MethodInfo[];
}

export interface ObjectModel {
  kind: 'object';
  fields: FieldInfo[];
}

export interface EnumModel {
  kind: 'enum';
  values: string[];
}

export type Model = ObjectModel | EnumModel;

export interface Reference {
  specVersion: string;
  sdkVersion: string;
  baseUrl: string;
  groups: GroupInfo[];
  models: Record<string, Model>;
}

let cache: Reference | null = null;
let inflight: Promise<Reference> | null = null;

export async function loadReference(): Promise<Reference> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch('/reference.json')
    .then((res) => {
      if (!res.ok) throw new Error(`reference.json: ${res.status}`);
      return res.json() as Promise<Reference>;
    })
    .then((ref) => {
      cache = ref;
      return ref;
    });
  return inflight;
}

export function findGroup(ref: Reference, accessor: string): GroupInfo | undefined {
  return ref.groups.find((g) => g.accessor === accessor);
}

export function findMethod(ref: Reference, accessor: string, name: string): MethodInfo | undefined {
  return findGroup(ref, accessor)?.methods.find((m) => m.name === name);
}

export function getModel(ref: Reference, name: string): Model | undefined {
  return ref.models[name];
}

/** Is a type string a named model the reference has a page for? */
export function isModelName(ref: Reference, type: string): boolean {
  // Unwrap common wrappers: `X[]`, `Array<X>`, `Record<string, X>`, unions.
  const inner = type
    .replace(/^Array<(.+)>$/, '$1')
    .replace(/\[\]$/, '')
    .trim();
  const head = inner.split('|')[0].trim();
  return head in ref.models;
}

/** Human-readable title for a group accessor: `adminConfig` → "Admin Config". */
export function groupTitle(accessor: string): string {
  return accessor
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}