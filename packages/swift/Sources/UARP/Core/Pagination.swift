import Foundation

/// Walk every page of a cursor-paginated endpoint, yielding individual items.
///
/// Generated resources expose this as `<method>All(...)`. Iteration stops when
/// the server reports `has_more: false`, returns a null cursor, hands back an
/// empty page, or repeats a cursor it already gave out.
public func autoPaginate<Page, Item>(
    fetch: @escaping @Sendable (String?) async throws -> Page,
    items: @escaping @Sendable (Page) -> [Item],
    cursor: @escaping @Sendable (Page) -> String?,
    hasMore: @escaping @Sendable (Page) -> Bool?
) -> AsyncThrowingStream<Item, Error> {
    AsyncThrowingStream { continuation in
        let task = Task {
            do {
                var next: String?
                var seen = Set<String>()
                //  An empty page is not the end: an API that applies the page
                //  size before filtering answers a request for two items with
                //  none and `has_more: true`, and stopping there loses
                //  everything behind it. Runaway protection is the repeated
                //  cursor below and this bound on consecutive empty pages.
                var consecutiveEmpty = 0
                let emptyPageLimit = 3
                while !Task.isCancelled {
                    let page = try await fetch(next)
                    let batch = items(page)
                    for item in batch { continuation.yield(item) }
                    if hasMore(page) == false { break }
                    consecutiveEmpty = batch.isEmpty ? consecutiveEmpty + 1 : 0
                    if consecutiveEmpty >= emptyPageLimit { break }
                    guard let candidate = cursor(page), !candidate.isEmpty, seen.insert(candidate).inserted else {
                        break
                    }
                    next = candidate
                }
                continuation.finish()
            } catch {
                continuation.finish(throwing: error)
            }
        }
        continuation.onTermination = { _ in task.cancel() }
    }
}

extension AsyncSequence {
    /// Collect an async sequence into an array, optionally stopping early.
    public func collect(limit: Int = .max) async throws -> [Element] {
        var out: [Element] = []
        for try await element in self {
            out.append(element)
            if out.count >= limit { break }
        }
        return out
    }
}
