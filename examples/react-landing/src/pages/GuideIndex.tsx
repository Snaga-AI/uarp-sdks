/** `/docs/guides` — index of task guides. Filled in Phase 3. */
import { Link } from 'react-router-dom';

const GUIDES = [
  'Install & authenticate',
  'Create, run and stream an agent',
  'Wait for completion / poll run status',
  'Cancel, approve, reject, pause, resume',
  'Knowledge bases: create, ingest, list',
  'Team / group runs (fan-in SSE)',
  'Files: upload, download, list',
  'Webhooks: create, list, deliveries',
  'A2A tasks: create, stream, cancel',
  'Public chat (guest sessions)',
  'Tenants & API keys',
  'Errors, pagination, idempotency, overrides',
] as const;

export function GuideIndex() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">Guides</h2>
      <p className="text-ink-soft">
        Task-focused walkthroughs, each with a sample in every language. These are being
        written — the list below is the plan, not yet linked.
      </p>
      <ol className="ml-5 flex list-decimal flex-col gap-2 text-ink-soft marker:text-ink-soft">
        {GUIDES.map((title) => (
          <li key={title} className="text-sm">{title}</li>
        ))}
      </ol>
      <p className="text-sm text-ink-soft">
        In the meantime, the <Link className="text-accent underline underline-offset-2" to="/docs/reference">reference</Link>{' '}
        already lists every operation.
      </p>
    </section>
  );
}