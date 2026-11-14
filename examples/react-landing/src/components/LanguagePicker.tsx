import { LANGUAGES, type LanguageId } from '../docs/content';
import { useLanguage } from '../hooks/useLanguage';

const REGISTRIES: Record<LanguageId, string> = {
  ts: 'https://www.npmjs.com/package/uarp-sdk',
  python: 'https://pypi.org/project/uarp-sdk/',
  rust: 'https://crates.io/crates/uarp-sdk',
  swift: 'https://github.com/Snaga-AI/uarp-swift',
  kotlin: 'https://central.sonatype.com/artifact/ai.snaga/uarp-sdk',
  ada: 'https://github.com/Snaga-AI/uarp-sdks/tree/main/packages/ada',
};

/** A synchronized preference for samples, never a claim that fixed TS reference has been translated. */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage } = useLanguage();
  const current = LANGUAGES.find(entry => entry.id === language)!;
  return <div className="min-w-0"><label className={`language-picker ${compact ? 'language-picker-compact' : ''}`}>
    <span className={compact ? 'sr-only' : 'eyebrow'}>Example language</span>
    <span className="language-select-wrap" style={compact ? { width: `max(88px, calc(${current.name.length}ch + 44px))` } : undefined}>
      <select aria-label="Example language" value={language} onChange={event => setLanguage(event.target.value as LanguageId)}>
        {LANGUAGES.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select>
      <svg className="language-select-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  </label>{!compact && <a href={REGISTRIES[language]} className="mt-2 inline-block text-[11px] text-ink-soft hover:text-accent-soft">{current.registry} package ↗</a>}</div>;
}
