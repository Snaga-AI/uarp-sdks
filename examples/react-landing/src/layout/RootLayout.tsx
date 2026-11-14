import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { VERSION } from 'uarp-sdk';
import { HeaderLogoMark } from '../components/HeaderLogoMark';
import { Search } from '../components/Search';
import { AgentWidget } from '../AgentWidget';

const SECTIONS = [
  { to: '/docs/guides/getting-started', label: 'Quickstart' },
  { to: '/docs/guides', label: 'Guides' },
  { to: '/docs/reference', label: 'API reference' },
  { to: '/docs/concepts/install', label: 'Concepts' },
];

export function RootLayout() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);
  return <div data-docs-route={location.pathname} className="min-h-screen bg-desk text-ink">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="sticky top-0 z-40 border-b border-rule-soft bg-desk/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-5 py-4 sm:gap-5">
        <Link to="/" className="group flex shrink-0 items-center gap-3 text-sm font-semibold"><HeaderLogoMark /><span>Snaga <span className="font-normal text-ink-soft">/ Docs</span></span></Link>
        <span data-testid="sdk-version" className="sdk-version rounded-full border border-rule-soft px-2.5 py-1 font-mono text-[10px] text-ink-soft">{VERSION}</span>
        <div className="ml-auto"><Search /></div>
        <button type="button" aria-label="Ask the agent" aria-haspopup="dialog" className="agent-header-trigger" onClick={() => window.dispatchEvent(new Event('docs:open-agent'))}>Chat</button>
        <a href="https://github.com/Snaga-AI/uarp-sdks" className="hidden text-xs text-ink-soft hover:text-ink sm:block">GitHub ↗</a>
      </div>
      <nav aria-label="Documentation sections" className="mx-auto flex max-w-[1440px] gap-5 overflow-x-auto px-5 sm:gap-7">
        {SECTIONS.map(section => {
          const active = section.label === 'Concepts' ? location.pathname.startsWith('/docs/concepts/')
            : section.label === 'Guides' ? location.pathname.startsWith('/docs/guides') && location.pathname !== '/docs/guides/getting-started'
            : section.label === 'API reference' ? location.pathname.startsWith('/docs/reference')
            : location.pathname === section.to;
          return <Link key={section.label} to={section.to} aria-current={active ? 'page' : false} className={`section-link ${active ? 'section-link-active' : ''}`}>{section.label}</Link>;
        })}
      </nav>
    </header>
    <Outlet />
    <AgentWidget />
  </div>;
}
