import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSearch, type SearchHit } from '../data/search';

const OPEN_SEARCH = 'docs:open-search';

export function SearchButton({ compact = false, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  return <button type="button" aria-label="Search documentation" aria-haspopup="dialog" className={compact ? 'search-trigger search-trigger-compact' : 'search-trigger'} onClick={() => {
    onOpen?.();
    window.dispatchEvent(new Event(OPEN_SEARCH));
  }}>
    <span aria-hidden>⌕</span><span className={compact ? 'hidden sm:inline' : ''}>Search docs</span>
    {!compact && <kbd className="ml-auto text-[10px] text-ink-soft">⌘/Ctrl K</kbd>}
  </button>;
}

/** A single modal lives in the root shell, so shortcuts work on every page and viewport. */
export function Search() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const titleId = useId();
  const navigate = useNavigate();

  useEffect(() => {
    const open = () => {
      if (dialogRef.current?.open) return;
      setQuery('');
      setHits([]);
      setError(false);
      dialogRef.current?.showModal();
      inputRef.current?.focus();
    };
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener(OPEN_SEARCH, open);
    window.addEventListener('keydown', shortcut);
    return () => {
      window.removeEventListener(OPEN_SEARCH, open);
      window.removeEventListener('keydown', shortcut);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setHits([]);
    setError(false);
    if (!query.trim()) { setLoading(false); return; }
    setLoading(true);
    useSearch().then(index => {
      if (!cancelled) setHits(index.search(query).slice(0, 12));
    }).catch(() => {
      if (!cancelled) setError(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [query, attempt]);

  const close = () => dialogRef.current?.close();
  const focusResult = (index: number) => {
    const buttons = resultsRef.current?.querySelectorAll('button');
    if (buttons?.length) buttons[(index + buttons.length) % buttons.length]?.focus();
  };

  return <>
    <SearchButton compact />
    <dialog ref={dialogRef} aria-labelledby={titleId} className="search-dialog" onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }}>
      <div className="border-b border-rule-soft p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3"><h2 id={titleId} className="eyebrow">Search documentation</h2><button type="button" onClick={close} aria-label="Close search" className="rounded-sm border border-rule-soft px-2 py-1 text-xs text-ink-soft">Esc</button></div>
        <label className="sr-only" htmlFor={`${titleId}-query`}>Search documentation</label>
        <input ref={inputRef} id={`${titleId}-query`} type="search" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search methods, guides, models…" className="w-full bg-transparent text-base text-ink outline-none sm:text-lg" onKeyDown={event => {
          if (event.key === 'ArrowDown' && hits.length) { event.preventDefault(); focusResult(0); }
          if (event.key === 'Enter' && hits[0]) { event.preventDefault(); close(); navigate(hits[0].to); }
        }} />
      </div>
      <div className="max-h-[55dvh] overflow-y-auto p-3" aria-busy={loading}>
        {!query.trim() && <div className="p-3"><p className="eyebrow mb-4">Start exploring</p><div className="grid gap-2">{[['Quickstart', '/docs/guides/getting-started'], ['Guides', '/docs/guides'], ['API reference', '/docs/reference']].map(([label, path]) => <Link key={path} to={path} onClick={close} className="search-result">{label}<span aria-hidden>→</span></Link>)}</div></div>}
        {loading && <p role="status" className="p-4 text-sm text-ink-soft">Searching documentation…</p>}
        {error && <div role="alert" className="p-4 text-sm text-ink-soft">Search could not load. <button className="text-accent-soft underline" type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
        {!loading && !error && query.trim() && !hits.length && <p role="status" className="p-4 text-sm text-ink-soft">No results for “{query}”. Try an operation, resource or guide name.</p>}
        <ul ref={resultsRef} className="space-y-1">{hits.map((hit, index) => <li key={hit.to}><button type="button" className="search-result w-full text-left" onClick={() => { close(); navigate(hit.to); }} onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); focusResult(index + 1); }
          if (event.key === 'ArrowUp') { event.preventDefault(); if (!index) inputRef.current?.focus(); else focusResult(index - 1); }
        }}><span className="min-w-0"><span translate="no" className={`block break-words text-sm ${hit.kind === 'method' || hit.kind === 'model' ? 'font-mono' : ''}`}>{hit.label}</span>{hit.detail && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-ink-soft">{hit.detail}</span>}</span><span className="shrink-0 rounded-full border border-rule-soft px-2 py-1 text-[10px] text-ink-soft">{hit.kind}</span></button></li>)}</ul>
      </div>
      <div className="border-t border-rule-soft px-6 py-3 text-xs text-ink-soft">↑ ↓ to explore · Enter to open · Esc to close</div>
    </dialog>
  </>;
}
