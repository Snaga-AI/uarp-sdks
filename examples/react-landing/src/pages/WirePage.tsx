/** `/docs/wire` — the 16 contract scenarios, with a per-language runner snippet each. */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { WireData } from '../data/wire';
import { loadWire } from '../data/wire';
import { useLanguage } from '../hooks/useLanguage';
import { usePageTitle } from '../hooks/usePageTitle';
import { DocHeader } from '../components/DocPage';
import { Code } from '../docs/Code';

const SCENARIOS_URL =
  'https://github.com/Snaga-AI/uarp-sdks/tree/main/contract/SCENARIOS.md';

/**
 * A tiny markdown-ish renderer for the SCENARIOS.md prose sections: paragraphs,
 * bullet lists (with soft-wrapped continuation lines), inline code and bold.
 * The source is stable hand-written prose, so this covers what it actually
 * contains rather than the whole spec — and avoids pulling in a markdown dep
 * for three paragraphs.
 */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;
  //  `` `code` `` first, then **bold** — backticks can sit inside bold but not
  //  the other way round, so split on code spans first.
  while (rest.length) {
    const code = rest.match(/`([^`]+)`/);
    const bold = rest.match(/\*\*([^*]+)\*\*/);
    const next = [code, bold].filter(Boolean).sort((a, b) => (a!.index! - b!.index!))[0];
    if (!next) {
      nodes.push(rest);
      break;
    }
    const idx = next.index!;
    if (idx > 0) nodes.push(rest.slice(0, idx));
    if (next === code) {
      nodes.push(
        <code key={`${keyBase}-${key++}`} className="notranslate font-mono text-ink" translate="no">
          {code![1]}
        </code>,
      );
    } else {
      nodes.push(
        <strong key={`${keyBase}-${key++}`} className="font-semibold text-ink">
          {bold![1]}
        </strong>,
      );
    }
    rest = rest.slice(idx + next[0].length);
  }
  return nodes;
}

function Markdownish({ body }: { body: string }) {
  const blocks = body.split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-ink-soft">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        if (lines[0].startsWith('- ')) {
          const items: string[] = [];
          for (const line of lines) {
            if (line.startsWith('- ')) items.push(line.slice(2));
            else if (items.length) items[items.length - 1] += ' ' + line.trim();
          }
          return (
            <ul key={bi} className="ml-5 flex list-disc flex-col gap-1 marker:text-ink-soft">
              {items.map((item, ii) => (
                <li key={ii}>{renderInline(item, `${bi}-${ii}`)}</li>
              ))}
            </ul>
          );
        }
        //  A paragraph: join soft-wrapped lines with a space.
        return <p key={bi}>{renderInline(lines.join(' '), `${bi}`)}</p>;
      })}
    </div>
  );
}

export function WirePage() {
  const { language } = useLanguage();
  usePageTitle('Wire · contract scenarios');
  const [wire, setWire] = useState<WireData | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadWire()
      .then((w) => !cancelled && setWire(w))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e : new Error(String(e))));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-8">
      <DocHeader eyebrow="Reference / SDK contract" title="Wire">
        <p className="text-ink-soft">
          Every SDK is pinned against the same twenty-two contract scenarios — the same calls
          replayed in TypeScript, Python, Rust, Swift, Kotlin and Ada, with a gate that refuses to pass
          on fewer than two SDKs agreeing. The point is not that each call succeeds but that all
          six put the same bytes on the wire for the same logical request.
        </p>
        <p className="text-sm text-ink-soft">
          {wire
            ? `${wire.scenarios.length} scenarios · ${wire.totalRequests} requests total · switch the language to see how each runner makes the call.`
            : 'Loading…'}
          {' '}
          The source is{' '}
          <a className="text-accent underline underline-offset-2" href={SCENARIOS_URL}>
            contract/SCENARIOS.md
          </a>
          .
        </p>
      </DocHeader>

      <p className="text-sm leading-7 text-ink-soft">These snippets are excerpts from the contract runners, not standalone programs. For complete imports, helper definitions and the local fixture command, see <a className="text-accent-soft underline" href="https://github.com/Snaga-AI/uarp-sdks/tree/main/contract">contract/run.sh and the language runners</a>. They execute against the local contract server, not a production tenant.</p>
      {error && <p className="text-ink-soft">Could not load the wire data: {error.message}</p>}

      {wire && (
        <ol className="flex flex-col gap-8">
          {wire.scenarios.map((s) => (
            <li key={s.num} id={`scenario-${s.num}`} className="scroll-mt-40 flex min-w-0 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="flex min-w-0 items-baseline gap-2 text-lg font-semibold tracking-tight">
                  <span className="shrink-0 font-mono text-sm text-ink-soft">#{s.num}</span>
                  <code className="notranslate min-w-0 break-words font-mono text-sm text-ink sm:text-base" translate="no">
                    {s.call}
                  </code>
                </h3>
                <p className="text-sm text-ink-soft">{s.pins}</p>
              </div>
              <Code selectable language={language}>{s.samples[language] || s.samples.ts}</Code>
            </li>
          ))}
        </ol>
      )}

      {wire?.sections.map((sec) => (
        <section key={sec.title} className="flex flex-col gap-2 border-t border-rule-soft pt-6">
          <h3 className="text-lg font-semibold tracking-tight">{sec.title}</h3>
          <Markdownish body={sec.body} />
        </section>
      ))}
    </section>
  );
}