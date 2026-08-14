/** Tiny indentation-aware source writer shared by all emitters. */
export class Writer {
  #lines: string[] = [];
  #depth = 0;
  readonly #unit: string;

  constructor(indentUnit = '  ') {
    this.#unit = indentUnit;
  }

  line(text = ''): this {
    this.#lines.push(text === '' ? '' : this.#unit.repeat(this.#depth) + text);
    return this;
  }

  /** Write several lines at once; blank entries stay blank. */
  lines(...texts: string[]): this {
    for (const t of texts) this.line(t);
    return this;
  }

  indent(body: () => void): this {
    this.#depth++;
    body();
    this.#depth--;
    return this;
  }

  /** `open` + indented body + `close`. */
  block(open: string, body: () => void, close: string): this {
    this.line(open);
    this.indent(body);
    this.line(close);
    return this;
  }

  /** Emit a doc comment, wrapping at ~96 columns. `prefix` is e.g. `/// ` or ` * `. */
  doc(text: string | undefined, prefix: string, open?: string, close?: string): this {
    if (!text) return this;
    const paragraphs = text.split('\n');
    const out: string[] = [];
    for (const para of paragraphs) {
      if (para.trim() === '') {
        out.push('');
        continue;
      }
      let current = '';
      for (const word of para.split(/\s+/)) {
        if (current && current.length + word.length + 1 > 92) {
          out.push(current);
          current = word;
        } else {
          current = current ? current + ' ' + word : word;
        }
      }
      if (current) out.push(current);
    }
    if (open) this.line(open);
    for (const l of out) this.line(l ? prefix + l : prefix.trimEnd());
    if (close) this.line(close);
    return this;
  }

  /** Drop trailing blank lines and finish with exactly one newline. */
  toString(): string {
    const copy = [...this.#lines];
    while (copy.length && copy[copy.length - 1] === '') copy.pop();
    return copy.join('\n') + '\n';
  }
}
