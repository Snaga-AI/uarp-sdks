import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { CONCEPT_ORDER, CONCEPTS } from '../content/concepts';
import { GUIDES } from '../content/guides';
import { useReference } from '../hooks/useReference';
import { LanguagePicker } from './LanguagePicker';

function SideLink({ to, children, onNavigate }: { to: string; children: ReactNode; onNavigate?: () => void }) {
  return <NavLink to={to} end onClick={onNavigate} className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}>{children}</NavLink>;
}
function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1"><p className="eyebrow mb-2 px-3 text-[10px]">{label}</p>{children}</div>;
}

function ReferenceLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { ref, error } = useReference();
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');
  const treeRef = useRef<HTMLDivElement>(null);
  useEffect(() => setQuery(''), [pathname]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const item = treeRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      const panel = treeRef.current?.closest<HTMLElement>('.sidebar-scroll, .mobile-nav-dialog');
      if (!item || !panel || !panel.getClientRects().length) return;
      const bounds = panel.getBoundingClientRect();
      const target = item.getBoundingClientRect();
      if (target.bottom > bounds.bottom - 24) panel.scrollTop += target.bottom - bounds.bottom + 24;
      else if (target.top < bounds.top + 24) panel.scrollTop -= bounds.top - target.top + 24;
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, ref]);
  if (error) return <p className="px-3 text-xs text-ink-soft">Resources could not load. Use search to retry.</p>;
  if (!ref) return <p role="status" className="px-3 text-xs text-ink-soft">Loading resources…</p>;
  const groups = ref.groups.filter(group => group.accessor.toLowerCase().includes(query.toLowerCase().trim()));
  return <div className="space-y-3">
    <label className="block"><span className="sr-only">Filter navigation resources</span><input className="doc-input" type="search" placeholder="Find a resource…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div ref={treeRef} className="space-y-1">{groups.map(group => <details key={group.accessor} open={pathname.startsWith(`/docs/reference/${group.accessor}/`) || pathname === `/docs/reference/${group.accessor}` || undefined} className="resource-tree">
      <summary><span className="min-w-0 flex-1 break-words">{group.accessor}</span><span className="text-[10px] text-ink-soft">{group.methods.length}</span></summary>
      <div className="ml-3 mt-1 flex flex-col gap-1 border-l border-rule-soft pl-2">
        <SideLink to={`/docs/reference/${group.accessor}`} onNavigate={onNavigate}>Overview</SideLink>
        {group.methods.map(method => <SideLink key={method.name} to={`/docs/reference/${group.accessor}/${method.name}`} onNavigate={onNavigate}><span translate="no" className="notranslate break-all font-mono text-[11px]">{method.name}</span></SideLink>)}
      </div>
    </details>)}</div>
    {!groups.length && <p role="status" className="px-3 text-xs text-ink-soft">No matching resources.</p>}
  </div>;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { pathname } = useLocation();
  const inReference = pathname.startsWith('/docs/reference');
  const concepts = <Group label="Concepts">{CONCEPT_ORDER.map(slug => <SideLink key={slug} to={`/docs/concepts/${slug}`} onNavigate={onNavigate}>{CONCEPTS[slug].title}</SideLink>)}</Group>;
  const guides = <Group label="Guides"><SideLink to="/docs/guides" onNavigate={onNavigate}>All guides</SideLink>{GUIDES.filter(guide => guide.slug !== 'getting-started').map(guide => <SideLink key={guide.slug} to={`/docs/guides/${guide.slug}`} onNavigate={onNavigate}>{guide.title}</SideLink>)}</Group>;
  return <nav aria-label="Documentation navigation" className="flex flex-col gap-6">
    {inReference ? <>
      <div className="rounded-sm border border-rule-soft p-3"><p className="eyebrow mb-2 text-[10px]">API reference</p><p className="text-xs text-ink-soft">TypeScript SDK · Generated signatures</p></div>
      <Group label="Resources"><SideLink to="/docs/reference" onNavigate={onNavigate}>All resource groups</SideLink><ReferenceLinks onNavigate={onNavigate} /></Group>
    </> : <>
      <LanguagePicker />
      <Group label="Start here"><SideLink to="/" onNavigate={onNavigate}>Overview</SideLink><SideLink to="/docs/guides/getting-started" onNavigate={onNavigate}>Quickstart</SideLink></Group>
      {pathname.startsWith('/docs/concepts') ? <>{concepts}{guides}</> : <>{guides}{concepts}</>}
      <Group label="Reference"><SideLink to="/docs/reference" onNavigate={onNavigate}>API reference</SideLink><SideLink to="/docs/wire" onNavigate={onNavigate}>Contract scenarios</SideLink></Group>
    </>}
  </nav>;
}
