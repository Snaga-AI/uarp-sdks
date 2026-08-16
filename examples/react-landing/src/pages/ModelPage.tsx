/** `/docs/reference/model/:model` — one model's fields. Filled in Phase 2. */
import { useParams, Link } from 'react-router-dom';
import { NotFound } from './NotFound';

export function ModelPage() {
  const { model } = useParams();
  if (!model) return <NotFound />;
  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        <Link className="text-accent underline underline-offset-2" to="/docs/reference">← Reference</Link>
      </p>
      <h2 className="font-mono text-2xl tracking-tight">{model}</h2>
      <p className="text-ink-soft">
        The fields table for this model is generated at build time and will appear here in the
        next phase.
      </p>
    </section>
  );
}