import { Link } from 'react-router-dom';
import { GUIDES } from '../content/guides';
import { usePageTitle } from '../hooks/usePageTitle';
import { DocHeader } from '../components/DocPage';

const COLLECTIONS = [
  { title: 'Agent workflows', description: 'Run agents, follow progress and coordinate their work.', slugs: ['run-and-stream', 'hitl-run-control', 'a2a-tasks', 'team-runs'] },
  { title: 'Data & integrations', description: 'Connect knowledge, files and applications.', slugs: ['knowledge-bases', 'files', 'webhooks', 'public-chat'] },
  { title: 'Operating your application', description: 'Manage access and handle real-world request behavior.', slugs: ['tenants-and-keys', 'errors-retries-overrides'] },
];

export function GuideIndex() {
  usePageTitle('Guides');
  return (
    <section className="flex flex-col gap-9">
      <DocHeader eyebrow="Learn / Guides" title="Guides">
        <p>Build one workflow at a time. Start with a working agent run, then add streaming, knowledge and integrations.</p>
        <p>Shared examples follow your selected SDK language. Task-specific examples are labeled TypeScript; use the API reference to look up their request and response types.</p>
      </DocHeader>
      <Link to="/docs/guides/getting-started" className="feature-card group">
        <span className="eyebrow text-accent-soft">Start here</span>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">Quickstart</h2>
        <p className="mt-2 max-w-xl text-sm leading-7 text-ink-soft">Install the SDK, connect your API key and run your first agent. Includes prerequisites and a complete TypeScript example.</p>
        <span className="mt-5 inline-block text-sm text-accent-soft">Make your first call <span aria-hidden>→</span></span>
      </Link>
      {COLLECTIONS.map((collection) => (
        <section key={collection.title} className="space-y-5">
          <div><h2 className="text-xl font-semibold tracking-tight">{collection.title}</h2><p className="mt-2 text-sm text-ink-soft">{collection.description}</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            {collection.slugs.map((slug) => {
              const guide = GUIDES.find((entry) => entry.slug === slug)!;
              return <Link key={slug} to={`/docs/guides/${slug}`} className="doc-card group">
                <h3 className="text-base font-semibold">{guide.title}</h3>
                <p className="mt-3 text-sm leading-6 text-ink-soft">{guide.summary}</p>
                <span className="mt-6 block text-sm text-accent-soft">Read guide <span aria-hidden>→</span></span>
              </Link>;
            })}
          </div>
        </section>
      ))}
    </section>
  );
}
