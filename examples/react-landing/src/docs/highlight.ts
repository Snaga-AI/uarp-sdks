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

const KEYWORDS = new Set([
  'import', 'from', 'export', 'const', 'let', 'var', 'function', 'return', 'await', 'async',
  'for', 'of', 'in', 'if', 'else', 'try', 'catch', 'finally', 'throw', 'new', 'class',
  'extends', 'interface', 'type', 'implements', 'instanceof', 'typeof', 'break', 'continue',
  'switch', 'case', 'default', 'this', 'null', 'undefined', 'true', 'false', 'void', 'yield',
]);

/**  `new Foo(` and `: Foo` — the two places a type name appears in these samples. */
const AFTER_NEW = /^(new|instanceof)\s+$/;

export function tokenise(source: string): Token[] {
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
    if (rest.startsWith('//')) {
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
