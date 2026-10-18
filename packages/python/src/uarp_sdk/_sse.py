"""Server-sent events: incremental frame parsing, and the streams built on it.

A GET stream reconnects with `Last-Event-ID` when the connection drops, the way
the other SDKs of this family do. A POST read as a stream (`stream_post`, an LLM
completion with `"stream": true`) is one attempt and never reconnects: a replay
would run, and bill, the model twice.
"""

from __future__ import annotations

import asyncio
import dataclasses
import enum
import json
import time
from typing import Any, AsyncIterator, Awaitable, Callable, FrozenSet, Iterator, List, Optional

import httpx

from ._errors import APIConnectionError, APIError, APITimeoutError, Problem, error_for_status, problem_from_bytes
from ._util import stream_backoff_delay


@dataclasses.dataclass(frozen=True)
class Event:
    """One decoded `text/event-stream` frame."""

    #: `event:` field; else the `type` inside a JSON payload; else `message`.
    event: str
    #: The `data:` lines joined with a newline.
    data: str
    #: `id:` field (or the `event_id` inside a JSON payload), replayed as
    #: `Last-Event-ID` when the stream reconnects.
    id: Optional[str] = None
    #: `retry:` field, in milliseconds.
    retry: Optional[int] = None

    def json(self) -> Any:
        """`data` parsed as JSON."""
        return json.loads(self.data)


class StreamState(enum.Enum):
    """Connection lifecycle, reported to `StreamOptions.on_state`."""

    #: About to open the connection, once, before the first attempt.
    CONNECTING = "connecting"
    #: The server answered 2xx and the stream is being read.
    CONNECTED = "connected"
    #: Waiting on backoff before a reconnect; the attempt is passed beside it.
    RECONNECTING = "reconnecting"
    #: The stream ended without the caller closing it. Not reported on `close()`.
    DISCONNECTED = "disconnected"


@dataclasses.dataclass
class StreamOptions:
    """Reconnection and lifecycle behaviour of a GET event stream.

    The defaults are a generic, standard SSE stream; the platform-specific knobs
    (terminal events, the inactivity watchdog) are opt-in.
    """

    #: Reconnect, replaying `Last-Event-ID`, when the stream ends.
    reconnect: bool = True
    #: Reconnect attempts without progress before giving up.
    max_reconnects: int = 5
    #: Event names that complete the stream without reconnecting.
    terminal_events: FrozenSet[str] = frozenset()
    #: Seconds of silence after which the socket is presumed dead and the
    #: stream reconnects. `None` leaves liveness to the end of the body.
    inactivity_timeout: Optional[float] = None
    #: Base reconnect interval in seconds; a `retry:` field overrides it.
    base_retry: float = 2.0
    #: Cap on the reconnect backoff, in seconds.
    max_backoff: float = 8.0
    #: The reconnect budget resets after this many seconds connected.
    stability_reset: float = 60.0
    #: Called with each `StreamState` (and, for `RECONNECTING`, the 1-based attempt).
    on_state: Optional[Callable[[StreamState, int], None]] = None


class Parser:
    """Incremental `text/event-stream` decoder.

    Reads the three shapes the platform sends: standard frames
    (`event:`/`id:`/`data:`/`retry:`, dispatched on a blank line), a JSON object
    carried in a comment (`:{"type":…,"event_id":…}`) and a bare NDJSON line,
    plus `data: [DONE]` as a hard end. A frame with no `data:` delivers nothing.
    Bytes are buffered rather than text, so a character split across two
    chunks survives.
    """

    def __init__(self) -> None:
        self._buffer = bytearray()
        self._data: List[str] = []
        self._event = ""
        self._id: Optional[str] = None
        self._retry: Optional[int] = None
        self._has_fields = False
        self.done = False

    def push(self, chunk: bytes) -> List[Event]:
        self._buffer.extend(chunk)
        events: List[Event] = []
        while True:
            index = self._buffer.find(b"\n")
            if index < 0:
                break
            line = bytes(self._buffer[:index])
            del self._buffer[: index + 1]
            if line.endswith(b"\r"):
                line = line[:-1]
            event = self._feed(line.decode("utf-8", "replace"))
            if event is not None:
                events.append(event)
            if self.done:
                #  Nothing after `[DONE]` is part of the stream.
                self._buffer.clear()
                break
        return events

    def finish(self) -> Optional[Event]:
        """Flush a frame the end of the body left unterminated."""
        if self.done:
            return None
        if self._buffer:
            line = bytes(self._buffer)
            self._buffer.clear()
            self._feed(line.decode("utf-8", "replace"))
        return self._dispatch()

    def _feed(self, line: str) -> Optional[Event]:
        if line == "":
            return self._dispatch()
        if line.startswith(":"):
            body = line[1:].strip()
            if body.startswith("{"):
                return _inline_event(body)
            return None  # a keep-alive
        if line.startswith("{"):
            return _inline_event(line)

        field, separator, value = line.partition(":")
        if separator and value.startswith(" "):
            value = value[1:]
        self._has_fields = True
        if field == "event":
            self._event = value
        elif field == "data":
            if value == "[DONE]":
                self.done = True
                if self._data or self._event or self._id is not None:
                    return self._dispatch()
                return None
            self._data.append(value)
        elif field == "id":
            if "\0" not in value:
                self._id = value
        elif field == "retry":
            self._retry = int(value) if value.isdigit() else None
        return None

    def _dispatch(self) -> Optional[Event]:
        if not self._has_fields:
            return None
        joined = "\n".join(self._data)
        if joined == "":
            self._reset()
            return None
        name = self._event or _extract_field(joined, "type") or "message"
        event = Event(event=name, data=joined, id=self._id, retry=self._retry)
        self._reset()
        return event

    def _reset(self) -> None:
        #  `id` belongs to its frame; the stream keeps the last one it saw for
        #  `Last-Event-ID` before this runs.
        self._data = []
        self._event = ""
        self._id = None
        self._retry = None
        self._has_fields = False


def _inline_event(body: str) -> Event:
    return Event(
        event=_extract_field(body, "type") or "message",
        data=body,
        id=_extract_field(body, "event_id"),
    )


def _extract_field(text: str, field: str) -> Optional[str]:
    """One string member of a JSON body, peeked without decoding the whole frame."""
    needle = f'"{field}"'
    start = text.find(needle)
    if start < 0:
        return None
    index = start + len(needle)
    while index < len(text) and text[index] in ": ":
        index += 1
    if index >= len(text) or text[index] != '"':
        return None
    index += 1
    value_start = index
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == '"':
            break
        index += 1
    if index <= value_start:
        return None
    return text[value_start:index]


def is_event_stream(content_type: Optional[str]) -> bool:
    """`text/event-stream`, parameters and case aside."""
    return (content_type or "").split(";")[0].strip().lower() == "text/event-stream"


def _report(options: StreamOptions, state: StreamState, attempt: int = 0) -> None:
    if options.on_state is not None:
        options.on_state(state, attempt)


def _api_error(response: httpx.Response, body: bytes) -> APIError:
    return error_for_status(response.status_code, problem_from_bytes(response.status_code, body), response.headers)


def _not_an_event_stream(response: httpx.Response, body: bytes) -> APIError:
    content_type = response.headers.get("content-type")
    problem = Problem(
        status=response.status_code,
        title="Not an event stream",
        detail=f"Expected text/event-stream, got {content_type or 'no Content-Type'}",
        extensions={"body": body.decode("utf-8", "replace")},
    )
    return APIError(response.status_code, problem, response.headers)


def _connection_error(error: Exception) -> APIConnectionError:
    if isinstance(error, httpx.TimeoutException):
        return APITimeoutError()
    return APIConnectionError(f"Connection error: {error}")


# --------------------------------------------------------------------- sync

#: Opens the response, streaming, for the `Last-Event-ID` given (None at first).
Connect = Callable[[Optional[str]], httpx.Response]


class EventStream:
    """A live event stream. Iterate it; `close()` (or leaving a `with`) ends it.

    The request is sent on the first iteration.
    """

    def __init__(self, events: Iterator[Event]) -> None:
        self._events = events

    def __iter__(self) -> "EventStream":
        return self

    def __next__(self) -> Event:
        return next(self._events)

    def close(self) -> None:
        close = getattr(self._events, "close", None)
        if close is not None:
            close()

    def __enter__(self) -> "EventStream":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def reconnecting(connect: Connect, options: StreamOptions) -> Iterator[Event]:
    last_event_id: Optional[str] = None
    attempt = 0
    base_retry = options.base_retry
    _report(options, StreamState.CONNECTING)

    while True:
        if attempt > 0:
            _report(options, StreamState.RECONNECTING, attempt)
            time.sleep(stream_backoff_delay(attempt, base_retry, options.max_backoff))
        try:
            response = connect(last_event_id)
        except httpx.TransportError as error:
            if not options.reconnect or attempt >= options.max_reconnects:
                raise _connection_error(error) from error
            attempt += 1
            continue

        try:
            if not response.is_success:
                #  A 401 always surfaces; the caller has to act on it. Any other
                #  status retries like a dropped connection while the budget lasts.
                if response.status_code == 401 or not options.reconnect or attempt >= options.max_reconnects:
                    raise _api_error(response, response.read())
                attempt += 1
                continue

            _report(options, StreamState.CONNECTED)
            delivered = False
            terminal = False
            broken = False
            parser = Parser()
            connected_at = time.monotonic()
            try:
                for chunk in response.iter_bytes():
                    if attempt > 0 and time.monotonic() - connected_at >= options.stability_reset:
                        attempt = 0
                    hit_terminal = False
                    for event in parser.push(chunk):
                        if event.id is not None:
                            last_event_id = event.id
                        if event.retry:
                            base_retry = event.retry / 1000
                        delivered = True
                        is_terminal = event.event in options.terminal_events
                        yield event
                        if is_terminal:
                            hit_terminal = True
                            break
                    if hit_terminal or parser.done:
                        terminal = True
                        break
            except httpx.TransportError:
                #  A silent socket (the watchdog) or a dropped one is not a
                #  finished stream: reconnect while the budget lasts.
                broken = True
            if broken and options.reconnect and attempt < options.max_reconnects:
                attempt += 1
                continue

            if not terminal:
                trailing = parser.finish()
                if trailing is not None:
                    if trailing.id is not None:
                        last_event_id = trailing.id
                    delivered = True
                    is_terminal = trailing.event in options.terminal_events
                    yield trailing
                    if is_terminal or parser.done:
                        terminal = True
            if terminal:
                _report(options, StreamState.DISCONNECTED)
                return
            #  A clean end without a terminal frame is a proxy or socket drop,
            #  not a finished stream.
            if delivered:
                attempt = 0
            if not options.reconnect or attempt >= options.max_reconnects:
                _report(options, StreamState.DISCONNECTED)
                return
            attempt += 1
        finally:
            response.close()


def single(send: Callable[[], httpx.Response]) -> Iterator[Event]:
    """One request, one response, no second attempt (`stream_post`)."""
    try:
        response = send()
    except httpx.TransportError as error:
        raise _connection_error(error) from error
    try:
        if not response.is_success:
            raise _api_error(response, response.read())
        if not is_event_stream(response.headers.get("content-type")):
            #  Decoded as events it would end with none and read as a finished
            #  answer. It is an error, with the body kept.
            raise _not_an_event_stream(response, response.read())
        parser = Parser()
        try:
            for chunk in response.iter_bytes():
                yield from parser.push(chunk)
                if parser.done:
                    return
        except httpx.TransportError as error:
            raise APIConnectionError(f"Event stream broke off: {error}") from error
        trailing = parser.finish()
        if trailing is not None:
            yield trailing
    finally:
        response.close()


# -------------------------------------------------------------------- async

AsyncConnect = Callable[[Optional[str]], Awaitable[httpx.Response]]


class AsyncEventStream:
    """A live event stream. Iterate it with `async for`; `aclose()` ends it.

    The request is sent on the first iteration.
    """

    def __init__(self, events: AsyncIterator[Event]) -> None:
        self._events = events

    def __aiter__(self) -> "AsyncEventStream":
        return self

    async def __anext__(self) -> Event:
        return await self._events.__anext__()

    async def aclose(self) -> None:
        close = getattr(self._events, "aclose", None)
        if close is not None:
            await close()

    async def __aenter__(self) -> "AsyncEventStream":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()


async def areconnecting(connect: AsyncConnect, options: StreamOptions) -> AsyncIterator[Event]:
    last_event_id: Optional[str] = None
    attempt = 0
    base_retry = options.base_retry
    _report(options, StreamState.CONNECTING)

    while True:
        if attempt > 0:
            _report(options, StreamState.RECONNECTING, attempt)
            await asyncio.sleep(stream_backoff_delay(attempt, base_retry, options.max_backoff))
        try:
            response = await connect(last_event_id)
        except httpx.TransportError as error:
            if not options.reconnect or attempt >= options.max_reconnects:
                raise _connection_error(error) from error
            attempt += 1
            continue

        try:
            if not response.is_success:
                if response.status_code == 401 or not options.reconnect or attempt >= options.max_reconnects:
                    raise _api_error(response, await response.aread())
                attempt += 1
                continue

            _report(options, StreamState.CONNECTED)
            delivered = False
            terminal = False
            broken = False
            parser = Parser()
            connected_at = time.monotonic()
            try:
                async for chunk in response.aiter_bytes():
                    if attempt > 0 and time.monotonic() - connected_at >= options.stability_reset:
                        attempt = 0
                    hit_terminal = False
                    for event in parser.push(chunk):
                        if event.id is not None:
                            last_event_id = event.id
                        if event.retry:
                            base_retry = event.retry / 1000
                        delivered = True
                        is_terminal = event.event in options.terminal_events
                        yield event
                        if is_terminal:
                            hit_terminal = True
                            break
                    if hit_terminal or parser.done:
                        terminal = True
                        break
            except httpx.TransportError:
                broken = True
            if broken and options.reconnect and attempt < options.max_reconnects:
                attempt += 1
                continue

            if not terminal:
                trailing = parser.finish()
                if trailing is not None:
                    if trailing.id is not None:
                        last_event_id = trailing.id
                    delivered = True
                    is_terminal = trailing.event in options.terminal_events
                    yield trailing
                    if is_terminal or parser.done:
                        terminal = True
            if terminal:
                _report(options, StreamState.DISCONNECTED)
                return
            if delivered:
                attempt = 0
            if not options.reconnect or attempt >= options.max_reconnects:
                _report(options, StreamState.DISCONNECTED)
                return
            attempt += 1
        finally:
            await response.aclose()


async def asingle(send: Callable[[], Awaitable[httpx.Response]]) -> AsyncIterator[Event]:
    """One request, one response, no second attempt (`stream_post`)."""
    try:
        response = await send()
    except httpx.TransportError as error:
        raise _connection_error(error) from error
    try:
        if not response.is_success:
            raise _api_error(response, await response.aread())
        if not is_event_stream(response.headers.get("content-type")):
            raise _not_an_event_stream(response, await response.aread())
        parser = Parser()
        try:
            async for chunk in response.aiter_bytes():
                for event in parser.push(chunk):
                    yield event
                if parser.done:
                    return
        except httpx.TransportError as error:
            raise APIConnectionError(f"Event stream broke off: {error}") from error
        trailing = parser.finish()
        if trailing is not None:
            yield trailing
    finally:
        await response.aclose()
