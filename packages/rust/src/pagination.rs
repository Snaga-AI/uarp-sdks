//! Helpers backing the generated `*_all` streaming methods.

use std::collections::HashSet;

/// Tracks cursors already requested so a server that keeps echoing the same
/// cursor cannot spin the caller forever.
#[derive(Debug, Default)]
pub(crate) struct CursorGuard {
    seen: HashSet<String>,
}

impl CursorGuard {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Returns the next cursor to use, or `None` when iteration should stop.
    pub(crate) fn advance(&mut self, cursor: Option<String>, has_more: Option<bool>, was_empty: bool) -> Option<String> {
        if has_more == Some(false) || was_empty {
            return None;
        }
        let cursor = cursor?;
        if cursor.is_empty() || !self.seen.insert(cursor.clone()) {
            return None;
        }
        Some(cursor)
    }
}
