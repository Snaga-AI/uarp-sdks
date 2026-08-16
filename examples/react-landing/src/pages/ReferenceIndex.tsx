/** `/docs/reference` — index of all 43 resource groups. Filled in Phase 2. */
import { Link } from 'react-router-dom';

export function ReferenceIndex() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">API reference</h2>
      <p className="text-ink-soft">
        Every one of the 557 operations across 43 resource groups, generated from the
        TypeScript SDK so it cannot drift from the wire. The index is built at build time from
        the generated sources — it will appear here in the next phase.
      </p>
      <p className="text-sm text-ink-soft">
        For now, browse the{' '}
        <a className="text-accent underline underline-offset-2" href="https://snaga.ai/docs">API reference on snaga.ai</a>{' '}
        or read the{' '}
        <Link className="text-accent underline underline-offset-2" to="/docs/concepts/calling">Calling the API</Link>{' '}
        concept.
      </p>
    </section>
  );
}