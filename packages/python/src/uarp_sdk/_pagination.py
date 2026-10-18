"""The rule behind the generated `*_all` methods: when to stop walking pages."""

from __future__ import annotations

from typing import Optional, Set

#: Consecutive empty pages tolerated before iteration gives up.
EMPTY_PAGE_LIMIT = 3


class CursorGuard:
    """Decides when to stop following a cursor.

    An empty page on its own is not the end: an API that applies the page size
    before filtering can answer a request for two items with none and
    `has_more: true`, and stopping there loses everything behind it. What does
    end the walk is `has_more: false`, a missing or empty cursor, a cursor the
    server already sent (it would loop forever), or a run of empty pages.
    """

    def __init__(self) -> None:
        self._seen: Set[str] = set()
        self._consecutive_empty = 0

    def advance(self, cursor: Optional[str], has_more: Optional[bool], was_empty: bool) -> Optional[str]:
        """The next cursor to request, or `None` when the walk is over."""
        if has_more is False:
            return None
        self._consecutive_empty = self._consecutive_empty + 1 if was_empty else 0
        if self._consecutive_empty >= EMPTY_PAGE_LIMIT:
            return None
        if not cursor or cursor in self._seen:
            return None
        self._seen.add(cursor)
        return cursor
