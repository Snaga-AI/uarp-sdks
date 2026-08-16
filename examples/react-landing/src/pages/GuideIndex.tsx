/** `/docs/guides` — index of task guides. */
import { Link } from 'react-router-dom';
import { GUIDES } from '../content/guides';

export function GuideIndex() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">Guides</h2>
        <p className="text-ink-soft">
          Task-focused walkthroughs. The install, auth, run, stream, error and pagination
          blocks carry a sample in every language; the rest are TypeScript, drawn from the{' '}
          <Link className="text-accent underline underline-offset-2" to="/docs/reference">
            reference
          </Link>{' '}
          so they cannot drift from the wire.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {GUIDES.map((g) => (
          <Link
            key={g.slug}
            to={`/docs/guides/${g.slug}`}
            className="group flex flex-col gap-1 rounded-lg border border-rule-soft p-4 transition hover:border-ink/30 hover:bg-ink/[0.02]"
          >
            <h3 className="text-sm font-medium text-ink">{g.title}</h3>
            <p className="line-clamp-2 text-xs text-ink-soft">{g.summary}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}