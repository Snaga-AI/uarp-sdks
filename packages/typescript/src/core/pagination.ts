/** Cursor pagination helpers for the `{ items, cursor, has_more }` envelope. */

export interface CursorPage<T> {
  items: T[];
  cursor: string | null;
  has_more?: boolean;
}

export type PageFetcher = (cursor: string | undefined) => Promise<unknown>;

/**
 * Walk every page of a cursor-paginated endpoint, yielding individual items.
 *
 * Generated resources expose this as `<method>All(...)`; the loop stops when
 * the server reports `has_more: false`, returns a null cursor, or hands back
 * an empty page (a guard against a server that never clears the cursor).
 */
export async function* autoPaginate<T>(
  fetchPage: PageFetcher,
  itemsProp: string,
  cursorProp: string,
  hasMoreProp: string | undefined,
): AsyncIterableIterator<T> {
  let cursor: string | undefined;
  const seen = new Set<string>();

  for (;;) {
    const page = (await fetchPage(cursor)) as Record<string, unknown> | undefined;
    if (!page) return;

    const items = page[itemsProp];
    if (Array.isArray(items)) {
      for (const item of items) yield item as T;
      if (items.length === 0) return;
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
