package ai.snaga.uarp

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Walk every page of a cursor-paginated endpoint, emitting individual items.
 *
 * Generated resources expose this as `<method>All(...)`. Iteration stops when
 * the server reports `has_more: false`, returns a null cursor, hands back an
 * empty page, or repeats a cursor it already gave out.
 */
public fun <Page, Item> autoPaginate(
    fetch: suspend (cursor: String?) -> Page,
    items: (Page) -> List<Item>,
    cursor: (Page) -> String?,
    hasMore: (Page) -> Boolean?,
): Flow<Item> = flow {
    var next: String? = null
    val seen = mutableSetOf<String>()

    while (true) {
        val page = fetch(next)
        val batch = items(page)
        for (item in batch) emit(item)
        if (batch.isEmpty() || hasMore(page) == false) return@flow
        val candidate = cursor(page)
        if (candidate.isNullOrEmpty() || !seen.add(candidate)) return@flow
        next = candidate
    }
}
