/** Cursor pagination helpers for the `{ items, cursor, has_more }` envelope. */

export interface CursorPage<T> {
  items: T[];
  cursor: string | null;
  has_more?: boolean;
}

export type PageFetcher = (cursor: string | undefined) => Promise<unknown>;

/** Consecutive empty pages tolerated before the walk gives up. */
const EMPTY_PAGE_LIMIT = 3;

/**
 * Walk every page of a cursor-paginated endpoint, yielding individual items.
 *
 * Generated resources expose this as `<method>All(...)`; the loop stops when
 * the server reports `has_more: false` or returns a null cursor.
 *
 * An empty page does *not* end the walk. A server that applies the page size
 * before filtering can answer a request for two items with none at all and
 * `has_more: true`, and treating that as the end silently loses everything
 * behind it — this API does exactly that. Runaway protection comes from the
 * repeated-cursor check below and from a bound on consecutive empty pages,
 * neither of which mistakes a short page for the end of the collection.
 */
export async function* autoPaginate<T>(
  fetchPage: PageFetcher,
  itemsProp: string,
  cursorProp: string,
  hasMoreProp: string | undefined,
): AsyncIterableIterator<T> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  let consecutiveEmpty = 0;

  for (;;) {
    const page = (await fetchPage(cursor)) as Record<string, unknown> | undefined;
    if (!page) return;

    const items = page[itemsProp];
    if (Array.isArray(items)) {
      for (const item of items) yield item as T;
      consecutiveEmpty = items.length === 0 ? consecutiveEmpty + 1 : 0;
      if (consecutiveEmpty >= EMPTY_PAGE_LIMIT) return;
    }

    const hasMore = hasMoreProp ? page[hasMoreProp] : undefined;
    if (hasMore === false) return;

    const next = page[cursorProp];
    if (typeof next !== 'string' || next === '') return;
    // Defend against a server echoing the same cursor forever.
    if (seen.has(next)) return;
    seen.add(next);
    cursor = next;
  }
}

/** Collect every item of a paginated endpoint into an array. */
export async function collect<T>(iterator: AsyncIterable<T>, limit = Number.POSITIVE_INFINITY): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterator) {
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
