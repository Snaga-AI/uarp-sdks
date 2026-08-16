/** `/docs/reference/:group/:method` — one operation. Filled in Phase 2. */
import { useParams, Link } from 'react-router-dom';
import { NotFound } from './NotFound';

export function MethodPage() {
  const { group, method } = useParams();
  if (!group || !method) return <NotFound />;
  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        <Link className="text-accent underline underline-offset-2" to={`/docs/reference/${group}`}>← {group}</Link>
      </p>
      <h2 className="font-mono text-2xl tracking-tight">{method}</h2>
      <p className="text-ink-soft">
        The signature, params table, request/response models, HTTP verb and path for this
        operation are generated at build time and will appear here in the next phase.
      </p>
    </section>
  );
}