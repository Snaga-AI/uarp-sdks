/**
 * A search box over the whole reference — methods, groups and models.
 *
 * The MiniSearch index is built on first focus (its own chunk), from the
 * reference payload that is already on its way or cached. Results link straight
 * to the route, so ⌘F-style lookup lands on the method page in one hop.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearch, type SearchHit, type SearchKind } from '../data/search';

const KIND_LABEL: Record<SearchKind, string> = {
  method: 'method',
  group: 'group',
  model: 'model',
};

export function Search() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    if (!query.trim()) {
      setHits([]);
      return;
    }
    useSearch().then((s) => {
      if (cancelled) return;
      setHits(s.search(query).slice(0, 8));
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  // ⌘K / Ctrl-K focuses the box from anywhere on a docs page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Search methods, groups, models…  ⌘K"
        className="w-full rounded-sm border border-rule-soft bg-paper-tint px-3 py-1.5 text-sm text-ink placeholder:text-ink-soft/70 focus:border-ink focus:outline-none"
      />
      {open && hits.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-auto rounded-sm border border-rule-soft bg-paper shadow-lg">
          {hits.map((hit) => (
            <li key={hit.to}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  navigate(hit.to);
                  setQuery('');
                  setHits([]);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start px-3 py-2 text-left transition hover:bg-ink/5"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <code className="font-mono text-sm text-ink">{hit.label}</code>
                  <span className="font-mono text-[0.6rem] tracking-wider text-ink-soft uppercase">
                    {KIND_LABEL[hit.kind]}
                  </span>
                </span>
                {hit.detail && (
                  <span className="line-clamp-1 text-xs text-ink-soft">{hit.detail}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}