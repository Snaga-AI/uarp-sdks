/**
 * The `/` route: the hero (install + the three-line hello), a short index into
 * the four documentation areas, and the footer. The live `<AgentWidget/>` is
 * mounted by the root layout, so it is present here too.
 */
import { Link } from 'react-router-dom';
import { VERSION } from 'uarp-sdk';
import { Code, Shell } from '../docs/Code';
import { HELLO, INSTALL, LANGUAGES } from '../docs/content';
import { useLanguage } from '../hooks/useLanguage';

const AREAS = [
  {
    to: '/docs/concepts/install',
    title: 'Concepts',
    body: 'Install, authenticate, call the API, handle errors, paginate, stream, retry — the ten things every consumer reads first.',
  },
  {
    to: '/docs/guides',
    title: 'Guides',
    body: 'Task-focused walkthroughs with a sample in every language: run and stream an agent, upload files, fan out a team run, wire a webhook.',
  },
  {
    to: '/docs/reference',
    title: 'Reference',
    body: 'Every one of the 557 operations across 43 resource groups, generated from the TypeScript SDK so it cannot drift from the wire.',
  },
  {
    to: '/docs/wire',
    title: 'Wire',
    body: 'The sixteen contract scenarios every SDK is pinned against — the same calls replayed in all five languages.',
  },
] as const;

export function Landing() {
  const { language } = useLanguage();
  const install = INSTALL[language];
  const current = LANGUAGES.find((entry) => entry.id === language)!;

  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-5">
      <div className="rounded-lg border border-rule-soft bg-paper px-5 py-10 sm:px-10 lg:px-12">
        <section className="pb-14">
          <p className="font-mono text-xs tracking-[0.18em] text-ink-soft uppercase">
            Client libraries for the UARP platform
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.08] font-bold tracking-tight text-balance sm:text-5xl">
            Three lines to an agent that answers.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-soft">
            One OpenAPI document, five clients — TypeScript, Rust, Swift, Kotlin and Ada — released
            together on one version number. Around 95% of each is generated, so they cannot drift
            from the platform or from each other.
          </p>
          <div className="mt-8 grid max-w-3xl min-w-0 gap-3">
            {install.shell ? <Shell>{install.command}</Shell> : <Code language={language}>{install.command}</Code>}
            <Code language={language}>{HELLO[language]}</Code>
            <p className="font-mono text-xs text-ink-soft">
              {current.registry} · {install.needs}
            </p>
          </div>
          <p className="mt-6 max-w-2xl text-sm text-ink-soft">
            The widget in the bottom corner runs exactly the code in{' '}
            <Link className="text-accent underline underline-offset-2" to="/docs/concepts/browser">In the browser</Link>.
            Give it your own key and it answers from your agents.
          </p>
        </section>

        <section className="border-t border-rule-soft pt-10 pb-8">
          <h2 className="text-2xl font-semibold tracking-tight">Documentation</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {AREAS.map((area) => (
              <Link
                key={area.to}
                to={area.to}
                className="group rounded-lg border border-rule-soft p-5 transition hover:border-ink/30 hover:bg-ink/[0.02]"
              >
                <h3 className="flex items-baseline justify-between text-lg font-semibold">
                  {area.title}
                  <span className="font-mono text-sm text-ink-soft opacity-0 transition group-hover:opacity-100">→</span>
                </h3>
                <p className="mt-2 text-sm text-ink-soft">{area.body}</p>
              </Link>
            ))}
          </div>
        </section>

        <footer className="border-t border-rule-soft pt-8 text-sm text-ink-soft">
          Documentation for the UARP client libraries at{' '}
          <span className="font-mono">{VERSION}</span> — one version across all five. This page is
          itself the example: everything it describes is running here, and the TypeScript and Rust
          samples are compiled on every build.
        </footer>
      </div>
    </div>
  );
}