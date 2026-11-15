import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useReference } from '../hooks/useReference';
import { usePageTitle } from '../hooks/usePageTitle';
import { DocHeader } from '../components/DocPage';

const ADMIN_GROUPS = new Set(['admin', 'adminConfig']);

export function ReferenceIndex() {
  usePageTitle('API reference');
  const { ref, error } = useReference();
  const [query, setQuery] = useState('');
  if (error) return <p role="alert" className="text-ink-soft">Could not load the reference: {error.message}</p>;
  if (!ref) return <p role="status" className="text-ink-soft">Loading the reference…</p>;
  const totalMethods = ref.groups.reduce((n, group) => n + group.methods.length, 0);
  const groups = ref.groups.filter((group) => `${group.accessor} ${group.description}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <section className="flex flex-col gap-8">
      <DocHeader eyebrow="Build / Reference" title="API reference">
        <p>Find the method, request fields and response types for your next call. Signatures and usage examples in this reference use the TypeScript SDK.</p>
        <p>{ref.groups.length} resource groups · {totalMethods} methods · SDK <span className="font-mono text-accent-soft">v{ref.sdkVersion}</span> · OpenAPI <span className="font-mono">{ref.specVersion}</span></p>
      </DocHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/docs/reference/agents" className="feature-card"><p className="eyebrow text-accent-soft">Core resource</p><h2 className="mt-3 text-xl font-semibold">Agents</h2><p className="mt-2 text-sm leading-6 text-ink-soft">Create and configure the agents your application runs.</p><span className="mt-5 block text-sm text-accent-soft">Explore methods →</span></Link>
        <Link to="/docs/reference/runs" className="doc-card"><p className="eyebrow">Execution</p><h2 className="mt-3 text-xl font-semibold">Runs</h2><p className="mt-2 text-sm leading-6 text-ink-soft">Start a run, inspect its status and stream events.</p><span className="mt-5 block text-sm text-accent-soft">Explore methods →</span></Link>
      </div>
      <section className="space-y-5" aria-labelledby="resource-groups">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="resource-groups" className="text-xl font-semibold">Resource groups</h2>
          <label className="w-full sm:w-72"><span className="sr-only">Filter resource groups</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter resource groups…" className="doc-input" /></label>
        </div>
        <p role="status" className="text-xs text-ink-soft">Showing {groups.length} of {ref.groups.length} groups</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((group) => <Link key={group.accessor} to={`/docs/reference/${group.accessor}`} className="doc-card group">
            <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words font-mono text-sm font-medium">{group.accessor}</h3><span className="shrink-0 rounded-full bg-black/25 px-2.5 py-1 text-xs text-ink-soft">{group.methods.length} methods</span></div>
            <p className="mt-3 text-sm leading-6 text-ink-soft">{group.description || `Operations available through client.${group.accessor}.`}</p>
            {ADMIN_GROUPS.has(group.accessor) && <span className="mt-4 inline-block text-xs text-accent-soft">Platform admin access</span>}
          </Link>)}
        </div>
        {!groups.length && <p className="rounded-lg bg-paper-tint p-6 text-sm text-ink-soft">No resource groups match “{query}”. Try a resource name such as agents or runs.</p>}
      </section>
    </section>
  );
}
