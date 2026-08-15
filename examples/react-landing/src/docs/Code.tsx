/**
 * A code sample you can read and take away.
 *
 * Every sample on this page is meant to be copied, so the copy button is not
 * decoration — it is the primary action, and it says what happened rather than
 * flashing an icon.
 */
import { useState } from 'react';
import { tokenise, type TokenKind } from './highlight';

/*
 * Highlighting inside the site's palette rather than the usual six-colour
 * rainbow. snaga.ai spends exactly one accent and keeps everything else in ink,
 * so a block lit up in emerald, violet and sky would be the loudest thing on
 * the page — and what a reader is here to trust is the code, not its colours.
 */
const COLOURS: Record<TokenKind, string> = {
  plain: '',
  comment: 'text-ink-soft/75 italic',
  string: 'text-ink-soft',
  number: 'text-ink-soft',
  keyword: 'text-accent',
  type: 'text-ink font-medium',
  property: 'text-ink',
};

export function Code({ children, language = 'ts' }: { children: string; language?: string }) {
  //  The label the reader sees is the language they picked; the tokeniser is
  //  told the same thing so Ada is not highlighted as if it were TypeScript.
  const [copied, setCopied] = useState(false);
  const source = children.trim();

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-rule-soft bg-code-bg">
      {/*
        A strip rather than a badge floating over the code. Absolutely
        positioned, it sat on top of the first line as soon as the viewport got
        narrow, and the copy button only appeared on hover — which a phone does
        not have, so the button a sample exists for was unreachable there.
      */}
      <div className="flex items-center justify-between border-b border-rule-soft px-3 py-1.5">
        <span className="font-mono text-[0.65rem] tracking-wider text-ink-soft uppercase">{language}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(source);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="rounded-sm px-2 py-0.5 text-xs text-ink-soft transition hover:bg-ink/5 hover:text-ink"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/*
        A browser translating this page will happily rewrite a code sample —
        translating its comments, its string literals, sometimes its keywords —
        and hand the reader something that does not compile. Marked so it is
        left alone.
      */}
      <pre
        className="notranslate overflow-x-auto p-4 font-mono text-[0.82rem] leading-relaxed"
        translate="no"
      >
        <code className="notranslate" translate="no">
          {tokenise(source, language).map((token, index) => (
            <span key={index} className={COLOURS[token.kind]}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/** A shell command: one line, no highlighting to get wrong. */
export function Shell({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative flex min-w-0 items-center gap-3 rounded-lg border border-rule-soft bg-code-bg px-4 py-3">
      <span className="text-ink-soft select-none">$</span>
      <code
        className="notranslate flex-1 overflow-x-auto font-mono text-[0.85rem] whitespace-nowrap"
        translate="no"
      >
        {children}
      </code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        className="shrink-0 rounded-sm border border-rule-soft px-2 py-0.5 text-xs text-ink-soft transition hover:bg-ink/5 hover:text-ink"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
