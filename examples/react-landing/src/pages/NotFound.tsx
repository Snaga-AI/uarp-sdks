/** A page that does not exist. Used as a route element and inlined by ConceptPage. */
import { Link } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';

export function NotFound() {
  usePageTitle('Not found');
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">Not found</h2>
      <p className="text-ink-soft">
        There is no page at this address. The documentation lives under{' '}
        <Link className="text-accent underline underline-offset-2" to="/docs/concepts/install">/docs</Link>.
      </p>
      <p className="text-ink-soft">
        <Link className="text-accent underline underline-offset-2" to="/">← Back to the landing</Link>
      </p>
    </section>
  );
}