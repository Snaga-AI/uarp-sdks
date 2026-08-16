/**
 * Set the document title for a route.
 *
 * The shell ships one static `<title>` for the landing; every other route sets
 * a specific title so a tab, a history entry and a search result name the page
 * the reader is actually on. The hook restores the previous title on unmount,
 * though in a SPA the next page sets its own anyway.
 */
import { useEffect } from 'react';

const SUFFIX = 'Snaga SDKs';

export function usePageTitle(title?: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} — ${SUFFIX}` : `${SUFFIX} — TypeScript, Rust, Swift, Kotlin, Ada`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}