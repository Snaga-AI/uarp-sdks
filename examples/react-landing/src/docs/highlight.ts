/**
 * A small TypeScript tokeniser, because the alternative is worse.
 *
 * A syntax highlighter loaded from a CDN is a third-party script on a page that
 * asks people to paste an API key, and bundling a full one costs more than
 * every sample on this page put together. This handles what the samples
 * actually contain and nothing else: comments, strings, numbers, keywords and
 * the identifier after `new`.
 *
 * It is deliberately not a parser. If a sample ever needs something it cannot
 * see, the worst outcome is a word rendered in the plain colour.
 */

export type TokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'type' | 'property';

export interface Token {
  kind: TokenKind;
  text: string;
}

const SHARED = [
  'import', 'from', 'export', 'const', 'let', 'var', 'function', 'return', 'await', 'async',
  'for', 'of', 'in', 'if', 'else', 'try', 'catch', 'finally', 'throw', 'new', 'class',
  'extends', 'interface', 'type', 'implements', 'instanceof', 'typeof', 'break', 'continue',
  'switch', 'case', 'default', 'this', 'null', 'undefined', 'true', 'false', 'void', 'yield',
];

/**
 * Keywords worth colouring, per language.
 *
 * Ada is the one that shares almost nothing with the others, so it gets its own
 * set rather than being highlighted as if it were TypeScript.
 */
const KEYWORDS_BY_LANGUAGE: Record<string, Set<string>> = {
  ts: new Set(SHARED),
  rust: new Set([...SHARED, 'fn', 'mut', 'match', 'impl', 'pub', 'use', 'struct', 'enum', 'while', 'loop', 'move', 'Some', 'None', 'Ok', 'Err', 'self']),
  swift: new Set([...SHARED, 'func', 'guard', 'struct', 'enum', 'var', 'do', 'where', 'some', 'try', 'nil', 'init', 'Decodable']),
  kotlin: new Set([...SHARED, 'fun', 'val', 'suspend', 'when', 'object', 'data', 'is', 'when', 'it']),
  ada: new Set([
    'with', 'use', 'procedure', 'function', 'is', 'begin', 'end', 'declare', 'constant',
    'loop', 'for', 'of', 'if', 'then', 'else', 'elsif', 'record', 'type', 'new', 'overriding',
    'in', 'out', 'return', 'exception', 'when', 'others', 'limited', 'null', 'not', 'and', 'or',
  ]),
};

let KEYWORDS = KEYWORDS_BY_LANGUAGE.ts!;

/**  `new Foo(` and `: Foo` — the two places a type name appears in these samples. */
const AFTER_NEW = /^(new|instanceof)\s+$/;

export function tokenise(source: string, language = 'ts'): Token[] {
  KEYWORDS = KEYWORDS_BY_LANGUAGE[language] ?? KEYWORDS_BY_LANGUAGE.ts!;
  const tokens: Token[] = [];
  let index = 0;
  let pending = '';

  const flush = (): void => {
    if (pending) {
      tokens.push({ kind: 'plain', text: pending });
      pending = '';
    }
  };
  const push = (kind: TokenKind, text: string): void => {
    flush();
    tokens.push({ kind, text });
  };

  while (index < source.length) {
    const rest = source.slice(index);

    //  Comments run to the end of the line, or to the closing marker.
    if (rest.startsWith('//') || (language === 'ada' && rest.startsWith('--'))) {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      push('comment', source.slice(index, stop));
      index = stop;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      push('comment', source.slice(index, stop));
      index = stop;
      continue;
    }

    //  Strings, including templates. Escapes are skipped so a quote inside one
    //  does not end it early.
    const quote = rest[0];
    if (quote === "'" || quote === '"' || quote === '`') {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (source[cursor] === quote) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      push('string', source.slice(index, cursor));
      index = cursor;
      continue;
    }

    const number = /^\d[\d_]*(\.\d+)?/.exec(rest);
    if (number && !/[\w$]/.test(source[index - 1] ?? '')) {
      push('number', number[0]);
      index += number[0].length;
      continue;
    }

    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (word) {
      const text = word[0];
      if (KEYWORDS.has(text)) {
        push('keyword', text);
      } else if (AFTER_NEW.test(pending.slice(-12)) || (tokens.at(-1)?.kind === 'keyword' && /new|instanceof/.test(tokens.at(-1)!.text) && !pending.trim())) {
        push('type', text);
      } else if (/^[A-Z]/.test(text)) {
        push('type', text);
      } else if (source[index + text.length] === ':' && source[index + text.length + 1] !== ':') {
        push('property', text);
      } else {
        pending += text;
      }
      index += text.length;
      continue;
    }

    pending += source[index];
    index += 1;
  }

  flush();
  return tokens;
}
