/** `/docs/reference` — the 43 resource groups, with method counts. */
import { Link } from 'react-router-dom';
import { useReference } from '../hooks/useReference';
import { usePageTitle } from '../hooks/usePageTitle';

const ADMIN_GROUPS = new Set(['admin', 'adminConfig']);

export function ReferenceIndex() {
  usePageTitle('API reference');
  const { ref, error } = useReference();
  if (error) return <p className="text-ink-soft">Could not load the reference: {error.message}</p>;
  if (!ref)
    return <p className="text-ink-soft">Loading the reference…</p>;

  const totalMethods = ref.groups.reduce((n, g) => n + g.methods.length, 0);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">API reference</h2>
        <p className="text-ink-soft">
          {ref.groups.length} resource groups · {totalMethods} methods · generated from the
          TypeScript SDK at <span className="font-mono text-xs">v{ref.sdkVersion}</span>{' '}
          (spec <span className="font-mono text-xs">{ref.specVersion}</span>). It cannot drift
          from the wire — both come from one OpenAPI document.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {ref.groups.map((g) => {
          const admin = ADMIN_GROUPS.has(g.accessor);
          return (
            <Link
              key={g.accessor}
              to={`/docs/reference/${g.accessor}`}
              className="group flex flex-col gap-1 rounded-lg border border-rule-soft p-4 transition hover:border-ink/30 hover:bg-ink/[0.02]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-mono text-sm font-medium text-ink">{g.accessor}</h3>
                <span className="font-mono text-xs text-ink-soft">{g.methods.length}</span>
              </div>
              <p className="line-clamp-2 text-xs text-ink-soft">{g.description}</p>
              {admin && (
                <span className="mt-1 w-fit rounded-sm border border-accent/40 px-1.5 py-0.5 font-mono text-[0.6rem] tracking-wider text-accent uppercase">
                  platform admin
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}