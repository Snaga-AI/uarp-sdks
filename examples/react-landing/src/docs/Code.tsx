/**
 * A code sample you can read and take away.
 *
 * Every sample on this page is meant to be copied, so the copy button is not
 * decoration — it is the primary action, and it says what happened rather than
 * flashing an icon.
 */
import { useState } from 'react';
import { tokenise, type TokenKind } from './highlight';

const COLOURS: Record<TokenKind, string> = {
  plain: '',
  comment: 'text-slate-400 dark:text-slate-500 italic',
  string: 'text-emerald-700 dark:text-emerald-300',
  number: 'text-amber-700 dark:text-amber-300',
  keyword: 'text-violet-700 dark:text-violet-300',
  type: 'text-sky-700 dark:text-sky-300',
  property: 'text-slate-700 dark:text-slate-200',
};

export function Code({ children, language = 'ts' }: { children: string; language?: string }) {
  //  The label the reader sees is the language they picked; the tokeniser is
  //  told the same thing so Ada is not highlighted as if it were TypeScript.
  const [copied, setCopied] = useState(false);
  const source = children.trim();

  return (
    <div className="group relative">
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
        <span className="font-mono text-[0.65rem] tracking-wider text-slate-400 uppercase">{language}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(source);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="rounded border border-slate-300 bg-white/80 px-2 py-0.5 text-xs text-slate-600 opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:text-white"
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
        className="notranslate overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-[0.82rem] leading-relaxed dark:border-slate-800 dark:bg-slate-900/60"
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
    <div className="group relative flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/60">
      <span className="text-slate-400 select-none">$</span>
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
        className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 opacity-0 transition group-hover:opacity-100 focus:opacity-100 dark:border-slate-700 dark:text-slate-300"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
