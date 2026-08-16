/**
 * Builds `public/reference.json` — the entire SDK API reference — by reading the
 * generated TypeScript sources with the compiler API.
 *
 * Why parse generated TS rather than `spec/openapi.json`: the generated TS is the
 * shipped artifact. Its JSDoc already carries the OpenAPI `summary`,
 * `description`, the `` `VERB /path` `` string, `Required scopes`, an SSE flag and
 * `@deprecated` (see `generator/src/emit/typescript.ts`, `operationDoc`), and its
 * typed signatures carry params, body type and return type. The reference is the
 * docs view of that same artifact, so it cannot drift from the wire — a wire
 * change regenerates both in one step.
 *
 * Runs from a Vite `buildStart` plugin (so it runs in `dev` and in `build`),
 * writing `public/reference.json`, which Vite serves verbatim and the reference
 * pages lazy-`fetch`. The landing bundle never imports it.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath, join } from 'node:path';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const LANDING = resolvePath(HERE, '..');
const GEN = resolvePath(LANDING, '../../packages/typescript/src/generated');
const RESOURCES_DIR = join(GEN, 'resources');
const OUT = resolvePath(LANDING, 'public/reference.json');

// -- types -----------------------------------------------------------------

interface FieldInfo {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
  default?: string;
  deprecated?: boolean;
}

interface ParamInfo {
  name: string;
  type: string;
  optional: boolean;
}

interface MethodInfo {
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
  returnType: string; // unwrapped inner type, e.g. "Agent"; "void"; "EventStream"
  returnKind: 'promise' | 'iterator' | 'sse';
}

interface GroupInfo {
  accessor: string;
  className: string;
  description: string;
  methods: MethodInfo[];
}

interface ObjectModel {
  kind: 'object';
  fields: FieldInfo[];
}
interface EnumModel {
  kind: 'enum';
  values: string[];
}
type Model = ObjectModel | EnumModel;

interface Reference {
  specVersion: string;
  sdkVersion: string;
  baseUrl: string;
  groups: GroupInfo[];
  models: Record<string, Model>;
}

// -- JSDoc helpers ---------------------------------------------------------

/** The raw inner text of a node's JSDoc — the opening marker, closing marker and per-line asterisk prefix are stripped. */
function rawJsDoc(node: ts.Node, sf: ts.SourceFile): string {
  const jd = (node as ts.JSDocContainer & { jsDoc?: ts.JSDoc[] }).jsDoc;
  if (!jd?.length) return '';
  const block = jd[0].getText(sf);
  return block
    .replace(/^\/\*\*?\s*/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .trim();
}

/** Parse a field-style JSDoc (description + `@default` + `@deprecated`) from raw text. */
function parseFieldDoc(raw: string): {
  description?: string;
  default?: string;
  deprecated: boolean;
} {
  const lines = raw.split('\n');
  const desc: string[] = [];
  let defaultVal: string | undefined;
  let deprecated = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('@default')) {
      defaultVal = trimmed.replace(/^@default\s*/, '');
      continue;
    }
    if (trimmed === '@deprecated' || trimmed.startsWith('@deprecated ')) {
      deprecated = true;
      continue;
    }
    desc.push(line);
  }
  const description = desc.join('\n').trim() || undefined;
  return { description, default: defaultVal, deprecated };
}

// -- parsing ---------------------------------------------------------------

function parseSource(filePath: string): ts.SourceFile {
  const text = readFileSync(filePath, 'utf8');
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function isPrimitive(type: string): boolean {
  const t = type.trim();
  return (
    t === 'string' ||
    t === 'number' ||
    t === 'boolean' ||
    t === 'void' ||
    t === 'BinaryInput' ||
    t === 'Blob'
  );
}

/** Unwrap `Promise<X>` / `AsyncIterableIterator<X>` / `EventStream` into inner type + kind. */
function unwrapReturn(rawReturn: string | undefined): {
  returnType: string;
  returnKind: 'promise' | 'iterator' | 'sse';
} {
  if (!rawReturn) return { returnType: 'void', returnKind: 'promise' };
  const r = rawReturn.trim();
  if (r === 'EventStream') return { returnType: 'EventStream', returnKind: 'sse' };
  const iter = r.match(/^AsyncIterableIterator<(.+)>$/);
  if (iter) return { returnType: iter[1].trim(), returnKind: 'iterator' };
  const prom = r.match(/^Promise<(.+)>$/);
  if (prom) return { returnType: prom[1].trim(), returnKind: 'promise' };
  return { returnType: r, returnKind: 'promise' };
}

/** Parse the `operationDoc`-shaped JSDoc of a method. */
function parseMethodDoc(raw: string): {
  summary: string;
  description?: string;
  httpMethod?: string;
  path?: string;
  scopes: string[];
  sse: boolean;
  deprecated: boolean;
} {
  const paragraphs = raw.split('\n\n').map((p) => p.trim()).filter(Boolean);
  let summary = '';
  let description: string | undefined;
  let httpMethod: string | undefined;
  let path: string | undefined;
  let scopes: string[] = [];
  let sse = false;
  let deprecated = false;

  const bodyParagraphs: string[] = [];
  for (const para of paragraphs) {
    if (para === '@deprecated' || para.startsWith('@deprecated ')) {
      deprecated = true;
      continue;
    }
    const verbMatch = para.match(/^`([A-Z]+)\s+(.+?)`$/);
    if (verbMatch) {
      httpMethod = verbMatch[1];
      path = verbMatch[2];
      continue;
    }
    if (para.startsWith('Required scopes:')) {
      const matches = para.matchAll(/`([^`]+)`/g);
      for (const m of matches) scopes.push(m[1]);
      continue;
    }
    if (para.startsWith('Returns a server-sent event stream')) {
      sse = true;
      continue;
    }
    bodyParagraphs.push(para);
  }

  if (bodyParagraphs.length) {
    summary = bodyParagraphs[0];
    if (bodyParagraphs.length > 1) {
      description = bodyParagraphs.slice(1).join('\n\n');
    }
  }
  return { summary, description, httpMethod, path, scopes, sse, deprecated };
}

/** Extract fields from an `export interface X { … }` declaration. */
function interfaceFields(node: ts.InterfaceDeclaration, sf: ts.SourceFile): FieldInfo[] {
  const fields: FieldInfo[] = [];
  for (const member of node.members) {
    if (!ts.isPropertySignature(member)) continue;
    const name = member.name.getText(sf);
    const optional = !!member.questionToken;
    const type = member.type ? member.type.getText(sf) : 'unknown';
    const raw = rawJsDoc(member, sf);
    const doc = parseFieldDoc(raw);
    fields.push({ name, type, optional, description: doc.description, default: doc.default, deprecated: doc.deprecated });
  }
  return fields;
}

/** All `*Params` interfaces in a resource file, keyed by interface name. */
function collectParamsInterfaces(sf: ts.SourceFile): Map<string, FieldInfo[]> {
  const out = new Map<string, FieldInfo[]>();
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text.endsWith('Params')) {
      out.set(stmt.name.text, interfaceFields(stmt, sf));
    }
  }
  return out;
}

function parseGroup(filePath: string, accessor: string, className: string, description: string): GroupInfo {
  const sf = parseSource(filePath);
  const paramsInterfaces = collectParamsInterfaces(sf);
  const methods: MethodInfo[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    if (!stmt.name || stmt.name.text !== className) continue;
    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const name = member.name.getText(sf);
      const rawReturn = member.type ? member.type.getText(sf) : undefined;
      const { returnType, returnKind } = unwrapReturn(rawReturn);

      const params: ParamInfo[] = member.parameters.map((p) => ({
        name: p.name.getText(sf),
        type: p.type ? p.type.getText(sf) : 'unknown',
        optional: !!p.questionToken || p.initializer !== undefined,
      }));

      const doc = parseMethodDoc(rawJsDoc(member, sf));
      const paginated = name === 'listAll' || returnKind === 'iterator';

      // Partition the signature params into path / query / body / options.
      const pathParams: ParamInfo[] = [];
      let queryParams: FieldInfo[] = [];
      let bodyType: string | undefined;
      let hasOptions = false;
      for (const p of params) {
        if (p.name === 'options' && p.type === 'RequestOptions') {
          hasOptions = true;
          continue;
        }
        if (p.type.endsWith('Params')) {
          queryParams = paramsInterfaces.get(p.type) ?? [];
          continue;
        }
        if (isPrimitive(p.type)) {
          pathParams.push(p);
          continue;
        }
        // A named, non-primitive type is the request body ( JsonObject, CreateAgentRequest, … ).
        bodyType = p.type;
      }

      const signature = `${name}(${params
        .map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`)
        .join(', ')}): ${rawReturn ?? 'void'}`;

      methods.push({
        name,
        signature,
        summary: doc.summary,
        description: doc.description,
        httpMethod: doc.httpMethod,
        path: doc.path,
        scopes: doc.scopes,
        sse: doc.sse || returnKind === 'sse',
        deprecated: doc.deprecated,
        paginated,
        params,
        pathParams,
        queryParams,
        bodyType,
        hasOptions,
        returnType,
        returnKind,
      });
    }
  }

  return { accessor, className, description, methods };
}

function parseModels(): Record<string, Model> {
  const sf = parseSource(join(GEN, 'models.ts'));
  const models: Record<string, Model> = {};
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      models[stmt.name.text] = { kind: 'object', fields: interfaceFields(stmt, sf) };
      continue;
    }
    if (ts.isTypeAliasDeclaration(stmt)) {
      const text = stmt.type.getText(sf);
      // String-literal unions → enum. Aliases to other types are skipped (the
      // target model is documented under its own name).
      const literals = [...text.matchAll(/'([^']*)'/g)].map((m) => m[1]);
      if (literals.length >= 2) {
        models[stmt.name.text] = { kind: 'enum', values: literals };
      }
    }
  }
  return models;
}

function parseMeta(): { specVersion: string; sdkVersion: string; baseUrl: string } {
  const sf = parseSource(join(GEN, 'meta.ts'));
  let specVersion = '';
  let sdkVersion = '';
  let baseUrl = '';
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const value = decl.initializer;
      if (value && ts.isStringLiteral(value)) {
        if (decl.name.text === 'SPEC_VERSION') specVersion = value.text;
        if (decl.name.text === 'SDK_VERSION') sdkVersion = value.text;
        if (decl.name.text === 'DEFAULT_BASE_URL') baseUrl = value.text;
      }
    }
  }
  return { specVersion, sdkVersion, baseUrl };
}

/** Parse `resources/index.ts`'s `Resources` interface: accessor → class + description.
 *  The className → filename map is read from the `import` statements, not derived
 *  from the class name — `A2AResource` lives in `a2a.ts`, which no camelCase→kebab
 *  rule reproduces. */
function parseGroupIndex(): { accessor: string; className: string; description: string; file: string }[] {
  const sf = parseSource(join(RESOURCES_DIR, 'index.ts'));

  // className → filename, from `import { XResource } from './x.js';`.
  const fileByClass = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const specifier = stmt.moduleSpecifier.getText(sf).replace(/^['"]|['"]$/g, '');
    const binder = stmt.importClause?.namedBindings;
    if (!binder || !ts.isNamedImports(binder)) continue;
    for (const el of binder.elements) {
      fileByClass.set(el.name.text, specifier.replace(/\.js$/, '.ts'));
    }
  }

  const out: { accessor: string; className: string; description: string; file: string }[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isInterfaceDeclaration(stmt) || stmt.name.text !== 'Resources') continue;
    for (const member of stmt.members) {
      if (!ts.isPropertySignature(member) || !member.type) continue;
      const accessor = member.name.getText(sf);
      const typeRef = member.type as ts.TypeReferenceNode;
      const className = typeRef.typeName.getText(sf);
      const description = rawJsDoc(member, sf);
      const file = fileByClass.get(className);
      if (!file) throw new Error(`no import maps class ${className} to a file in resources/index.ts`);
      out.push({ accessor, className, description, file });
    }
  }
  return out;
}

export function generateReference(): Reference {
  const meta = parseMeta();
  const index = parseGroupIndex();
  const groups: GroupInfo[] = [];
  for (const entry of index) {
    groups.push(parseGroup(join(RESOURCES_DIR, entry.file), entry.accessor, entry.className, entry.description));
  }
  const models = parseModels();
  return { ...meta, groups, models };
}

/** Write `public/reference.json` only when content changed — avoids HMR churn in dev. */
export function writeReferenceIfChanged(): boolean {
  const ref = generateReference();
  const json = JSON.stringify(ref, null, 2) + '\n';
  if (existsSync(OUT)) {
    if (readFileSync(OUT, 'utf8') === json) return false;
  }
  if (!existsSync(resolvePath(OUT, '..'))) mkdirSync(resolvePath(OUT, '..'), { recursive: true });
  writeFileSync(OUT, json);
  return true;
}

// `node scripts/gen-reference.ts` → generate and print a summary.
if (import.meta.url === `file://${process.argv[1]}`) {
  const changed = writeReferenceIfChanged();
  const ref = generateReference();
  const methodCount = ref.groups.reduce((n, g) => n + g.methods.length, 0);
  const objectModels = Object.values(ref.models).filter((m) => m.kind === 'object').length;
  const enumModels = Object.values(ref.models).filter((m) => m.kind === 'enum').length;
  console.log(
    `reference.json ${changed ? 'written' : 'unchanged'} — ${ref.groups.length} groups, ${methodCount} methods, ${objectModels} object models, ${enumModels} enums (SDK ${ref.sdkVersion}, spec ${ref.specVersion})`,
  );
}