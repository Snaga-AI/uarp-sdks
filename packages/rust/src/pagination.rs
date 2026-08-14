//! Helpers backing the generated `*_all` streaming methods.

use std::collections::HashSet;

/// Consecutive empty pages tolerated before iteration gives up.
const EMPTY_PAGE_LIMIT: u8 = 3;

/// Decides when to stop walking pages.
///
/// A server that keeps echoing the same cursor cannot spin the caller forever,
/// and neither can one that answers with empty page after empty page. An empty
/// page on its own is *not* the end: an API that applies the page size before
/// filtering can answer a request for two items with none and `has_more: true`,
/// and stopping there loses everything behind it.
#[derive(Debug, Default)]
pub(crate) struct CursorGuard {
    seen: HashSet<String>,
    consecutive_empty: u8,
}

impl CursorGuard {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Returns the next cursor to use, or `None` when iteration should stop.
    pub(crate) fn advance(
        &mut self,
        cursor: Option<String>,
        has_more: Option<bool>,
        was_empty: bool,
    ) -> Option<String> {
        if has_more == Some(false) {
            return None;
        }
        self.consecutive_empty = if was_empty { self.consecutive_empty + 1 } else { 0 };
        if self.consecutive_empty >= EMPTY_PAGE_LIMIT {
            return None;
        }
        let cursor = cursor?;
        if cursor.is_empty() || !self.seen.insert(cursor.clone()) {
            return None;
        }
        Some(cursor)
    }
}
