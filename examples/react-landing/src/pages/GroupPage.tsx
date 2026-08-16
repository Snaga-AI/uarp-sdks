/** `/docs/reference/:group` — the methods in one resource group. */
import { Link, useParams } from 'react-router-dom';
import { useReference } from '../hooks/useReference';
import { usePageTitle } from '../hooks/usePageTitle';
import { NotFound } from './NotFound';
import { MethodBadge } from '../components/MethodBadge';

export function GroupPage() {
  const { group } = useParams();
  usePageTitle(group ? `${group} · API reference` : 'API reference');
  const { ref, error } = useReference();

  if (error) return <p className="text-ink-soft">Could not load the reference: {error.message}</p>;
  if (!ref) return <p className="text-ink-soft">Loading…</p>;

  const g = ref.groups.find((x) => x.accessor === group);
  if (!g) return <NotFound />;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b border-rule-soft pb-4">
        <p className="text-sm text-ink-soft">
          <Link className="text-accent underline underline-offset-2" to="/docs/reference">Reference</Link>
        </p>
        <h2 className="font-mono text-2xl tracking-tight">{g.accessor}</h2>
        <p className="text-ink-soft">{g.description}</p>
        <p className="font-mono text-xs text-ink-soft">{g.methods.length} methods</p>
      </header>

      <ul className="flex flex-col gap-1">
        {g.methods.map((m) => (
          <li key={m.name}>
            <Link
              to={`/docs/reference/${g.accessor}/${m.name}`}
              className="group grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 rounded-sm px-2 py-2 transition hover:bg-ink/[0.03]"
            >
              <code className="font-mono text-sm text-ink">{m.name}</code>
              <span className="min-w-0 truncate text-xs text-ink-soft">
                {m.httpMethod ? `${m.httpMethod} ${m.path}` : m.summary}
              </span>
              <span className="flex shrink-0 gap-1">
                <MethodBadge method={m} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}