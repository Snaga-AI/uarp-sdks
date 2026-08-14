/** Identifier casing helpers plus per-language reserved-word escaping. */

/**
 * Words kept fully upper-case in identifiers. `id` is deliberately absent:
 * `agentId` reads better than `agentID` in every target language here.
 */
const ACRONYMS = new Set([
  'api', 'url', 'urls', 'uri', 'sse', 'http', 'https', 'json', 'jwt',
  'llm', 'mcp', 'acp', 'a2a', 'gdpr', 'sql', 'uuid', 'csv', 'pdf', 'dlq', 'cors',
]);

/** Split an arbitrary identifier into lowercase words. */
export function words(input: string): string[] {
  const out: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push(buf.toLowerCase());
    buf = '';
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (/[^A-Za-z0-9]/.test(ch)) {
      flush();
      continue;
    }
    const prev = input[i - 1];
    const next = input[i + 1];
    const isUpper = /[A-Z]/.test(ch);
    // Boundary before an uppercase run that starts a new word (fooBar, HTTPServer).
    // Digits never start a boundary, so `A2A` and `v1` survive as single words.
    if (isUpper && prev && (/[a-z]/.test(prev) || (/[A-Z]/.test(prev) && next && /[a-z]/.test(next)))) {
      flush();
    }
    buf += ch;
  }
  flush();
  return out.filter(Boolean);
}

export function pascal(input: string): string {
  return words(input)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join('');
}

export function camel(input: string): string {
  const p = words(input).map((w, i) => {
    if (i === 0) return w;
    return ACRONYMS.has(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1);
  });
  return p.join('');
}

export function snake(input: string): string {
  return words(input).join('_');
}

export function screamingSnake(input: string): string {
  return words(input).join('_').toUpperCase();
}

export function kebab(input: string): string {
  return words(input).join('-');
}

/** `Ada_Style_Identifiers`. */
export function adaName(input: string): string {
  const w = words(input).map((x) => (ACRONYMS.has(x) ? x.toUpperCase() : x[0]!.toUpperCase() + x.slice(1)));
  let name = w.join('_');
  if (/^[0-9]/.test(name)) name = 'N_' + name;
  return name;
}

/**
 * Crude singularisation, used to name hoisted array item types and to shorten
 * method names. Words that merely end in `s` without being plural (`status`,
 * `analysis`, `address`) are left alone.
 */
export function singular(input: string): string {
  if (/(us|ss|is)$/i.test(input)) return input;
  if (/ies$/i.test(input)) return input.slice(0, -3) + 'y';
  if (/(s|x|z|ch|sh)es$/i.test(input)) return input.slice(0, -2);
  if (/s$/i.test(input)) return input.slice(0, -1);
  return input;
}

const TS_RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import',
  'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'implements', 'interface', 'let', 'package', 'private',
  'protected', 'public', 'static', 'yield', 'await',
]);

const RUST_RESERVED = new Set([
  'as', 'async', 'await', 'become', 'box', 'break', 'const', 'continue', 'crate', 'do', 'dyn',
  'else', 'enum', 'extern', 'false', 'final', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop',
  'macro', 'match', 'mod', 'move', 'mut', 'override', 'priv', 'pub', 'ref', 'return', 'self',
  'Self', 'static', 'struct', 'super', 'trait', 'true', 'try', 'type', 'typeof', 'unsafe',
  'unsized', 'use', 'virtual', 'where', 'while', 'yield', 'abstract',
]);

const SWIFT_RESERVED = new Set([
  'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func', 'import',
  'init', 'inout', 'internal', 'let', 'open', 'operator', 'private', 'protocol', 'public',
  'rethrows', 'static', 'struct', 'subscript', 'typealias', 'var', 'break', 'case', 'continue',
  'default', 'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat', 'return',
  'switch', 'where', 'while', 'as', 'Any', 'catch', 'false', 'is', 'nil', 'super', 'self', 'Self',
  'throw', 'throws', 'true', 'try', 'associativity', 'Type', 'Protocol', 'description', 'hash',
]);

const KOTLIN_RESERVED = new Set([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface',
  'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias',
  'typeof', 'val', 'var', 'when', 'while', 'by', 'catch', 'constructor', 'delegate', 'dynamic',
  'field', 'file', 'finally', 'get', 'import', 'init', 'param', 'property', 'receiver', 'set',
  'setparam', 'value', 'where', 'internal',
]);

/** Ada 2022 reserved words (case-insensitive). */
const ADA_RESERVED = new Set([
  'abort', 'abs', 'abstract', 'accept', 'access', 'aliased', 'all', 'and', 'array', 'at', 'begin',
  'body', 'case', 'constant', 'declare', 'delay', 'delta', 'digits', 'do', 'else', 'elsif', 'end',
  'entry', 'exception', 'exit', 'for', 'function', 'generic', 'goto', 'if', 'in', 'interface',
  'is', 'limited', 'loop', 'mod', 'new', 'not', 'null', 'of', 'or', 'others', 'out', 'overriding',
  'package', 'parallel', 'pragma', 'private', 'procedure', 'protected', 'raise', 'range', 'record',
  'rem', 'renames', 'requeue', 'return', 'reverse', 'select', 'separate', 'some', 'subtype',
  'synchronized', 'tagged', 'task', 'terminate', 'then', 'type', 'until', 'use', 'when', 'while',
  'with', 'xor',
]);

/**
 * Escape a TypeScript *binding* name. Property and method names never need
 * this — `{ delete(): void }` is legal — but a parameter or local called
 * `default` is not.
 */
export function tsIdent(name: string): string {
  return TS_RESERVED.has(name) ? name + '_' : name;
}

export function rustIdent(name: string): string {
  return RUST_RESERVED.has(name) ? 'r#' + name : name;
}

export function swiftIdent(name: string): string {
  return SWIFT_RESERVED.has(name) ? '`' + name + '`' : name;
}

export function kotlinIdent(name: string): string {
  return KOTLIN_RESERVED.has(name) ? '`' + name + '`' : name;
}

export function adaIdent(name: string): string {
  return ADA_RESERVED.has(name.toLowerCase()) ? name + '_K' : name;
}

/** True when a JS property name can be written without quotes. */
export function isPlainJsKey(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}
