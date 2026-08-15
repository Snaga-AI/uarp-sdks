import type { ReactNode } from 'react';

/**
 * A documentation section with a stable anchor.
 *
 * The heading is the link target, so every section can be pointed at from a
 * chat message or a bug report — which is most of what documentation is for.
 */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-slate-200 pt-12 dark:border-slate-800">
      <h2 className="group flex items-baseline gap-2 text-2xl font-semibold tracking-tight">
        <a href={`#${id}`} className="hover:underline">
          {title}
        </a>
        <span className="font-mono text-sm text-slate-300 opacity-0 transition group-hover:opacity-100 dark:text-slate-600">
          #
        </span>
      </h2>
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * An identifier inside a sentence — a header name, a status code, a field.
 *
 * `translate="no"` is not decoration. A browser translating this page rewrites
 * the sentence in the target language's word order and carries inline elements
 * along with it; a paragraph holding ten of them ends up with all ten in a heap
 * at the end, and a reader sees `Idempotency-Key408 409429 500502 503504` and
 * reasonably asks whose keys those are. Marking them keeps a translator from
 * touching or moving them — and the prose around them is written so that the
 * sentence still says something true if one is moved anyway.
 */
export function Term({ children }: { children: ReactNode }) {
  return (
    <code className="notranslate font-mono" translate="no">
      {children}
    </code>
  );
}

export function Note({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  const styles =
    tone === 'warn'
      ? 'border-amber-400 bg-amber-50 dark:border-amber-600/60 dark:bg-amber-950/30'
      : 'border-sky-400 bg-sky-50 dark:border-sky-600/60 dark:bg-sky-950/30';
  return (
    <div className={`rounded-r-md border-l-[3px] px-4 py-3 text-sm leading-relaxed ${styles}`}>{children}</div>
  );
}
