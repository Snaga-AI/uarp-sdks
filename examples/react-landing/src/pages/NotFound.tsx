/** A page that does not exist. Used as a route element and inlined by ConceptPage. */
import { Link, useOutletContext } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';

export function NotFound() {
  usePageTitle('Not found');
  const context = useOutletContext<{ docsLayout?: boolean } | undefined>();
  const content = (
    <section className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">Not found</h1>
      <p className="text-ink-soft">
        There is no page at this address. The documentation lives under{' '}
        <Link className="text-accent underline underline-offset-2" to="/docs/concepts/install">/docs</Link>.
      </p>
      <p className="text-ink-soft">
        <Link className="text-accent underline underline-offset-2" to="/">← Back to the landing</Link>
      </p>
    </section>
  );
  return context?.docsLayout ? content : <main id="main-content" tabIndex={-1} className="doc-shell"><div className="doc-surface p-6 sm:p-10">{content}</div></main>;
}