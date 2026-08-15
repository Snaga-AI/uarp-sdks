import type { ReactNode } from 'react';

/**
 * A documentation section with a stable anchor.
 *
 * The heading is the link target, so every section can be pointed at from a
 * chat message or a bug report — which is most of what documentation is for.
 */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-rule-soft pt-12">
      <h2 className="group flex items-baseline gap-2 text-2xl font-semibold tracking-tight">
        <a href={`#${id}`} className="hover:underline">
          {title}
        </a>
        <span className="font-mono text-sm text-ink-soft opacity-0 transition group-hover:opacity-100">
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

/**
 * An aside.
 *
 * The site has one accent and spends it sparingly, so a warning gets the accent
 * and an ordinary note gets a plain rule. Two notes that shouted in different
 * colours would be louder than anything on snaga.ai.
 */
export function Note({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  const styles =
    tone === 'warn'
      ? 'border-accent bg-accent/5 text-ink'
      : 'border-rule bg-paper-tint text-ink-soft';
  return (
    <div className={`rounded-r-sm border-l-[3px] px-4 py-3 text-sm leading-relaxed ${styles}`}>{children}</div>
  );
}
