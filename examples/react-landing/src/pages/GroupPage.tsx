/** `/docs/reference/:group` — methods in one resource group. Filled in Phase 2. */
import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { NotFound } from './NotFound';

export function GroupPage() {
  const { group } = useParams();
  if (!group) return <NotFound />;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-mono text-2xl tracking-tight">{group}</h2>
      <p className="text-ink-soft">
        The method list for this group is generated at build time and will appear here in the
        next phase.
      </p>
      <p className="text-sm text-ink-soft">
        <Link className="text-accent underline underline-offset-2" to="/docs/reference">← All groups</Link>
      </p>
    </section>
  );
}