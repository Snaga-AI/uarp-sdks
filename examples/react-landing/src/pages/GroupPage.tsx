import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useReference } from '../hooks/useReference';
import { usePageTitle } from '../hooks/usePageTitle';
import { NotFound } from './NotFound';
import { MethodBadge } from '../components/MethodBadge';
import { DocHeader } from '../components/DocPage';

export function GroupPage() {
  const { group } = useParams();
  usePageTitle(group ? `${group} · API reference` : 'API reference');
  const { ref, error } = useReference();
  const [query, setQuery] = useState('');
  if (error) return <p role="alert" className="text-ink-soft">Could not load the reference: {error.message}</p>;
  if (!ref) return <p role="status" className="text-ink-soft">Loading…</p>;
  const resource = ref.groups.find((entry) => entry.accessor === group);
  if (!resource) return <NotFound />;
  const methods = resource.methods.filter((method) => `${method.name} ${method.summary} ${method.httpMethod} ${method.path}`.toLowerCase().includes(query.toLowerCase().trim()));
  return (
    <section className="flex flex-col gap-8">
      <DocHeader eyebrow={<><Link to="/docs/reference">API reference</Link><span>/</span><span>Resource</span></>} title={resource.accessor} mono>
        <p>{resource.description}</p>
        <p>{resource.methods.length} methods · SDK v{ref.sdkVersion}</p>
      </DocHeader>
      <div className="rounded-lg bg-paper-tint p-5 text-sm leading-7 text-ink-soft">Use <code translate="no" className="notranslate font-mono text-accent-soft">client.{resource.accessor}</code> to access this resource. Open a method for its signature, required scopes, parameters and a usage example.</div>
      <section className="space-y-4" aria-labelledby="methods-title">
        <div className="flex flex-wrap items-center justify-between gap-4"><h2 id="methods-title" className="text-xl font-semibold">Methods</h2><label className="w-full sm:w-72"><span className="sr-only">Filter methods</span><input className="doc-input" type="search" placeholder="Filter methods…" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
        <ul className="flex flex-col gap-3">
          {methods.map((method) => <li key={method.name}><Link to={`/docs/reference/${resource.accessor}/${method.name}`} className="doc-card block">
            <div className="flex flex-wrap items-center gap-3"><code translate="no" className="notranslate break-all font-mono text-sm text-ink">{method.name}</code><MethodBadge method={method} /></div>
            {method.summary && <p className="mt-2 text-sm leading-6 text-ink-soft">{method.summary}</p>}
            {method.httpMethod && <div className="mt-4 flex items-start gap-3"><span className="http-verb">{method.httpMethod}</span><code translate="no" className="notranslate min-w-0 break-all font-mono text-xs leading-6 text-ink-soft">{method.path}</code></div>}
          </Link></li>)}
        </ul>
        {!methods.length && <p role="status" className="rounded-lg bg-paper-tint p-5 text-sm text-ink-soft">No methods match “{query}”.</p>}
      </section>
    </section>
  );
}
