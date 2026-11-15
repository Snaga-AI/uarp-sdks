import { Link } from 'react-router-dom';
import { VERSION } from 'uarp-sdk';
import { Code, Shell } from '../docs/Code';
import { HELLO, INSTALL, LANGUAGES } from '../docs/content';
import { useLanguage } from '../hooks/useLanguage';
import { usePageTitle } from '../hooks/usePageTitle';

const AREAS = [
  { to: '/docs/guides/getting-started', number: '01', title: 'Start building', body: 'Install your SDK, connect a key and make your first agent run.', label: 'Quickstart' },
  { to: '/docs/guides', number: '02', title: 'Build something useful', body: 'Stream responses, add knowledge, upload files and coordinate agents.', label: 'Explore guides' },
  { to: '/docs/reference', number: '03', title: 'Find the right method', body: 'Look up request fields, response types and required scopes.', label: 'API reference' },
];

export function Landing() {
  const { language } = useLanguage();
  usePageTitle();
  const install = INSTALL[language];
  const current = LANGUAGES.find((entry) => entry.id === language)!;
  return (
    <main id="main-content" tabIndex={-1} className="doc-shell">
      <div className="doc-surface overflow-hidden">
        <section className="grid min-w-0 items-center gap-12 px-6 py-12 sm:px-12 sm:py-20 xl:grid-cols-[1fr_1.1fr] xl:px-16">
          <div>
            <p className="eyebrow flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-accent" />Snaga / Developer platform</p>
            <h1 className="mt-7 max-w-xl text-5xl leading-[1.06] font-semibold tracking-[-0.055em] sm:text-6xl">Your agents.<br /><span className="text-ink-soft">Your language.</span></h1>
            <p className="mt-7 max-w-md text-base leading-7 text-ink-soft">Build with the UARP platform in TypeScript, Python, Rust, Swift, Kotlin or Ada. Run agents, stream their responses and connect them to your application.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={`/docs/guides/getting-started?lang=${language}`} className="primary-link">Start building <span aria-hidden>↗</span></Link>
              <Link to="/docs/reference" className="secondary-link">API reference <span aria-hidden>→</span></Link>
            </div>
            <p className="mt-6 text-xs text-ink-soft">Six native SDKs <span className="mx-2">·</span> v{VERSION}</p>
          </div>
          <div className="min-w-0 rounded-[28px] bg-paper-tint p-4 sm:p-6">
            <div className="mb-5 flex items-center justify-between"><p className="eyebrow">A first look</p><span className="rounded-full bg-black/30 px-3 py-1 text-xs text-ink-soft">{current.name}</span></div>
            <div className="grid min-w-0 gap-4">
              {install.shell ? <Shell>{install.command}</Shell> : <Code selectable language={language}>{install.command}</Code>}
              <Code selectable language={language}>{HELLO[language]}</Code>
            </div>
            <p className="mt-4 text-xs leading-6 text-ink-soft">A preview of the run flow. The Quickstart covers imports, authentication and the agent ID. Requires {install.needs}.</p>
            {language === 'ada' && <p className="mt-2 text-xs text-accent-soft">For Ada package availability and setup, see the <Link className="underline" to="/docs/concepts/install">installation notes</Link>.</p>}
          </div>
        </section>
        <section className="border-t border-rule-soft px-6 py-10 sm:px-12 xl:px-16">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-3"><h2 className="text-2xl font-semibold tracking-tight">From first call to production.</h2><p className="text-sm text-ink-soft">A path through the documentation</p></div>
          <div className="grid gap-4 md:grid-cols-3">{AREAS.map((area) => <Link key={area.to} to={area.to} className="group rounded-lg bg-paper-tint p-6 transition hover:bg-chip"><span className="font-mono text-xs text-accent">{area.number}</span><h3 className="mt-6 text-lg font-semibold">{area.title}</h3><p className="mt-3 text-sm leading-6 text-ink-soft">{area.body}</p><p className="mt-8 flex justify-between text-sm">{area.label}<span className="text-accent transition group-hover:translate-x-1" aria-hidden>→</span></p></Link>)}</div>
        </section>
        <footer className="flex flex-wrap justify-between gap-4 border-t border-rule-soft px-6 py-6 text-xs text-ink-soft sm:px-12 xl:px-16"><span>Snaga SDKs · Built for your stack.</span><Link className="hover:text-ink" to="/docs/wire">Explore the SDK contract →</Link></footer>
      </div>
    </main>
  );
}
