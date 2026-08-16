/**
 * The sidebar tree. Active state comes from the route (NavLink), not the
 * IntersectionObserver the single-page version used — routing owns "where am I"
 * now, and the observer only had to exist at all because everything was one page.
 */
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { CONCEPT_ORDER, CONCEPTS } from '../content/concepts';
import { GUIDES } from '../content/guides';

function SideLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `-ml-px border-l py-1 pl-4 text-sm transition ${
          isActive
            ? 'border-ink font-medium text-ink'
            : 'border-transparent text-ink-soft hover:text-ink'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="px-0 pb-1 pl-4 font-mono text-[0.65rem] tracking-wider text-ink-soft uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

export function Sidebar() {
  return (
    <nav className="flex flex-col gap-4 border-l border-rule-soft">
      <Group label="Concepts">
        {CONCEPT_ORDER.map((slug) => (
          <SideLink key={slug} to={`/docs/concepts/${slug}`}>
            {CONCEPTS[slug].title}
          </SideLink>
        ))}
      </Group>
      <Group label="Guides">
        <SideLink to="/docs/guides">All guides</SideLink>
        {GUIDES.map((g) => (
          <SideLink key={g.slug} to={`/docs/guides/${g.slug}`}>
            {g.title}
          </SideLink>
        ))}
      </Group>
      <Group label="Reference">
        <SideLink to="/docs/reference">All 43 groups</SideLink>
      </Group>
      <Group label="Wire">
        <SideLink to="/docs/wire">Contract scenarios</SideLink>
      </Group>
    </nav>
  );
}