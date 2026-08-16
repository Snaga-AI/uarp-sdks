/**
 * The shell every route shares: the header and the live agent widget.
 *
 * The header is lifted from the old single-page App unchanged in shape — the
 * one substitution is that the language switcher now writes `?lang=` to the URL
 * (via `useLanguage`) instead of holding state it had to re-sync from a hash.
 */
import { Outlet } from 'react-router-dom';
import { VERSION } from 'uarp-sdk';
import { AgentWidget } from '../AgentWidget';
import { useLanguage } from '../hooks/useLanguage';
import { LANGUAGES, type LanguageId } from '../docs/content';

/** Where each package actually lives, for the link in the header. */
const REGISTRY_URL: Record<LanguageId, string> = {
  ts: 'https://www.npmjs.com/package/uarp-sdk',
  rust: 'https://crates.io/crates/uarp-sdk',
  swift: 'https://github.com/Snaga-AI/uarp-swift',
  kotlin: 'https://central.sonatype.com/artifact/ai.snaga/uarp-sdk',
  ada: 'https://github.com/alire-project/alire-index/pull/2059',
};

export function RootLayout() {
  const { language, setLanguage } = useLanguage();
  const current = LANGUAGES.find((entry) => entry.id === language)!;

  return (
    <div className="min-h-screen bg-desk text-ink">
      <header className="sticky top-0 z-40 border-b border-rule-soft bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-5">
          <a href="https://snaga.ai" className="flex shrink-0 items-center gap-2 text-sm font-semibold hover:text-accent">
            <span aria-hidden>←</span> Snaga
          </a>
          <div className="hidden min-w-0 flex-1 text-center sm:block">
            <p className="text-sm font-semibold">SDKs</p>
            <p className="font-mono text-[0.7rem] text-ink-soft">{VERSION}</p>
          </div>
          <div className="ml-auto flex items-center gap-0.5 overflow-x-auto rounded-sm border border-rule-soft p-0.5 sm:ml-0">
            {LANGUAGES.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setLanguage(entry.id)}
                className={`shrink-0 rounded-sm px-2 py-1 text-xs transition ${
                  language === entry.id
                    ? 'bg-ink font-medium text-paper'
                    : 'text-ink-soft hover:bg-ink/5 hover:text-ink'
                }`}
              >
                {entry.name}
              </button>
            ))}
          </div>
          <a
            href={REGISTRY_URL[language]}
            className="hidden shrink-0 rounded-sm border border-rule-soft px-3 py-1.5 text-sm hover:bg-ink/5 lg:block"
          >
            {current.registry}
          </a>
          <a
            href="https://github.com/Snaga-AI/uarp-sdks"
            className="hidden shrink-0 rounded-sm border border-rule-soft px-3 py-1.5 text-sm hover:bg-ink/5 lg:block"
          >
            GitHub
          </a>
        </div>
      </header>

      <Outlet />

      <AgentWidget />
    </div>
  );
}