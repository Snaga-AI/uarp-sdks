/** `/docs/guides/:slug` — a single task guide. Filled in Phase 3. */
import { useParams } from 'react-router-dom';
import { NotFound } from './NotFound';

export function GuidePage() {
  const { slug } = useParams();
  if (!slug) return <NotFound />;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">Guide</h2>
      <p className="text-ink-soft">
        This guide is not written yet. It will land in a later phase, with a sample in every
        language.
      </p>
    </section>
  );
}