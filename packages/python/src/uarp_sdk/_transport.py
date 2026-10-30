"""The transport: auth, retries, idempotency, body encoding, response decoding.

`Client` and `AsyncClient` share everything here except the two loops that send
a request and wait between attempts.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import os
import time
import uuid
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Union

import httpx

from ._errors import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    ConfigError,
    DecodeError,
    EncodeError,
    error_for_status,
    problem_from_bytes,
)
from ._files import FilePart
from ._models import decode, encode
from ._sse import (
    AsyncEventStream,
    Event,
    EventStream,
    StreamOptions,
    areconnecting,
    asingle,
    reconnecting,
    single,
)
from ._util import backoff_delay, build_query, encode_form, join_url, json_text, parse_retry_after, random_id, scalar_text

#  Not 409: a conflict is the server's answer about the state of the resource
#  (`CLIENT_REQUEST_CONFLICT`, `VERSION_CONFLICT`), and sending the same request
#  again meets the same state.
_RETRYABLE = frozenset((408, 429, 500, 502, 503, 504))

#: Mints the short-lived key a `sse_token_in_query` stream puts in its URL.
SSE_TOKENS = "/api/v1/auth/sse-tokens"

#: Passed as a header value in `RequestOptions.headers`, removes that header.
OMIT: Any = None


@dataclasses.dataclass
class RequestOptions:
    """Per-call overrides. Pass as `request_options=` to any generated method."""

    #: Seconds before the call times out; overrides the client's.
    timeout: Optional[float] = None
    #: Retries for transient failures; overrides the client's.
    max_retries: Optional[int] = None
    #: Reuse a specific `Idempotency-Key`, e.g. to safely replay a create.
    idempotency_key: Optional[str] = None
    #: Extra headers; a value of `None` removes a header the SDK would send.
    headers: Mapping[str, Optional[str]] = dataclasses.field(default_factory=dict)
    #: Extra query parameters, added after the operation's own.
    query: Mapping[str, Any] = dataclasses.field(default_factory=dict)
    #: Reconnection behaviour, for event streams.
    stream: Optional[StreamOptions] = None

    def merged(self, other: Optional["RequestOptions"]) -> "RequestOptions":
        """These options with `other`'s set fields on top."""
        if other is None:
            return self
        return RequestOptions(
            timeout=other.timeout if other.timeout is not None else self.timeout,
            max_retries=other.max_retries if other.max_retries is not None else self.max_retries,
            idempotency_key=other.idempotency_key if other.idempotency_key is not None else self.idempotency_key,
            headers={**self.headers, **other.headers},
            query={**self.query, **other.query},
            stream=other.stream if other.stream is not None else self.stream,
        )


@dataclasses.dataclass(frozen=True)
class Body:
    """A request body as a generated method describes it."""

    value: Any
    #: `json`, `form`, `multipart` or `binary`.
    encoding: str = "json"
    #: For a form: the field names in schema order. For multipart: each part's
    #: name and whether it is a file.
    fields: Sequence[Any] = ()


@dataclasses.dataclass(frozen=True)
class Response:
    """What a generated method expects back."""

    #: `json`, `binary`, `text` or `void`.
    kind: str = "json"
    type: Any = None
    #: A JSON `null` is a valid answer.
    nullable: bool = False


VOID = Response(kind="void")
BINARY = Response(kind="binary")
TEXT = Response(kind="text")


@dataclasses.dataclass(frozen=True)
class _Encoded:
    content: Optional[bytes]
    content_type: Optional[str]


def _encode_body(body: Optional[Body]) -> _Encoded:
    if body is None:
        return _Encoded(None, None)
    if body.encoding == "json":
        return _Encoded(json_text(encode(body.value)).encode("utf-8"), "application/json")
    if body.encoding == "form":
        values = encode(body.value)
        if not isinstance(values, dict):
            raise EncodeError("a form body has to be an object")
        names = list(body.fields) or list(values)
        names += [name for name in values if name not in names]
        return _Encoded(encode_form((name, values.get(name)) for name in names), "application/x-www-form-urlencoded")
    if body.encoding == "multipart":
        return _multipart(body)
    if body.encoding == "binary":
        value = body.value
        if isinstance(value, FilePart):
            return _Encoded(bytes(value.data), value.content_type or "application/octet-stream")
        if isinstance(value, str):
            value = value.encode("utf-8")
        return _Encoded(bytes(value), "application/octet-stream")
    raise EncodeError(f"unknown body encoding {body.encoding!r}")


def _multipart(body: Body) -> _Encoded:
    values = encode(body.value, keep_files=True)
    if not isinstance(values, dict):
        raise EncodeError("a multipart body has to be an object")
    declared = [(name, is_file) for name, is_file in body.fields]
    names = {name for name, _ in declared}
    declared += [(name, False) for name in values if name not in names]

    boundary = f"uarp-{uuid.uuid4().hex}"
    out = bytearray()
    for name, _ in declared:
        value = values.get(name)
        if value is None:
            continue
        out += f"--{boundary}\r\n".encode("ascii")
        if isinstance(value, (bytes, bytearray, memoryview, FilePart)):
            part = value if isinstance(value, FilePart) else FilePart(data=bytes(value))
            out += (
                f'Content-Disposition: form-data; name="{_quote(name)}"; filename="{_quote(part.filename)}"\r\n'
                f"Content-Type: {part.content_type or 'application/octet-stream'}\r\n\r\n"
            ).encode("utf-8")
            out += bytes(part.data)
        else:
            out += f'Content-Disposition: form-data; name="{_quote(name)}"\r\n\r\n'.encode("utf-8")
            out += scalar_text(value).encode("utf-8")
        out += b"\r\n"
    out += f"--{boundary}--\r\n".encode("ascii")
    return _Encoded(bytes(out), f"multipart/form-data; boundary={boundary}")


def _quote(name: str) -> str:
    #  The escaping the HTML standard gives a multipart name or filename.
    return name.replace("\r", "%0D").replace("\n", "%0A").replace('"', "%22")


def _read_env(*names: str) -> Optional[str]:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


class BaseClient:
    """Configuration and request building, shared by `Client` and `AsyncClient`."""

    _user_agent_name = "uarp-sdk-python"

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        timeout: float = 60.0,
        max_retries: int = 2,
        default_headers: Optional[Mapping[str, str]] = None,
        user_agent: Optional[str] = None,
        sse_token_in_query: bool = False,
        idempotency_key_factory: Optional[Callable[[], str]] = None,
    ) -> None:
        from .generated.meta import DEFAULT_BASE_URL, SDK_VERSION

        #  An OMITTED key is a mistake and raises: it catches the common
        #  "forgot to set UARP_API_KEY". An EXPLICIT empty string is a
        #  statement — this client carries no credentials of its own — and it
        #  sends no `Authorization` header at all. A set-but-empty environment
        #  variable is the omission, not the statement.
        if api_key is None:
            api_key = _read_env("UARP_API_KEY", "SNAGA_API_KEY")
            if api_key is None:
                raise ConfigError(
                    "Missing API key. Pass `Client(api_key=...)` or set the UARP_API_KEY environment variable. "
                    'For a client whose credentials travel another way, pass `api_key=""`.'
                )
        self.api_key: str = api_key
        self.base_url: str = (base_url or _read_env("UARP_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.default_headers: Dict[str, str] = dict(default_headers or {})
        agent = f"{self._user_agent_name}/{SDK_VERSION}"
        self.user_agent = f"{agent} {user_agent}" if user_agent else agent
        self.sse_token_in_query = sse_token_in_query
        self._idempotency_key_factory = idempotency_key_factory or random_id
        self._options = RequestOptions()

    # ------------------------------------------------------------ building

    def _url(self, path: str, query: Iterable[Tuple[str, Any]], options: RequestOptions) -> str:
        pairs = list(query) + list(options.query.items())
        encoded = build_query(pairs)
        url = join_url(self.base_url, path)
        return f"{url}?{encoded}" if encoded else url

    def _headers(
        self,
        accept: str,
        headers: Iterable[Tuple[str, Any]],
        idempotency_key: Optional[str],
        content_type: Optional[str],
        options: RequestOptions,
    ) -> Dict[str, str]:
        out: Dict[str, str] = {"Accept": accept, "User-Agent": self.user_agent}
        #  `Bearer ` with nothing after it is not the same as no header: a
        #  server that validates the value can refuse it.
        if self.api_key:
            out["Authorization"] = f"Bearer {self.api_key}"
        _set_all(out, self.default_headers.items())
        _set_all(out, ((name, scalar_text(value)) for name, value in headers if value is not None))
        if idempotency_key is not None:
            out["Idempotency-Key"] = idempotency_key
        if content_type is not None:
            _set_all(out, [("Content-Type", content_type)])
        for name, value in options.headers.items():
            _remove(out, name)
            if value is not None:
                out[name] = value
        return out

    def _idempotency_key(self, idempotent: bool, options: RequestOptions) -> Optional[str]:
        if not idempotent:
            return None
        return options.idempotency_key or self._idempotency_key_factory()

    def _stream_headers(
        self, headers: Sequence[Tuple[str, Any]], last_event_id: Optional[str], options: RequestOptions
    ) -> Dict[str, str]:
        #  On a reconnect the id the last delivered event carried replaces any
        #  `Last-Event-ID` the caller passed; on the first attempt the
        #  caller's stays — a public replay route keys off it.
        if last_event_id is not None:
            headers = [(name, value) for name, value in headers if name.lower() != "last-event-id"]
            headers = [*headers, ("Last-Event-ID", last_event_id)]
        return self._headers("text/event-stream", headers, None, None, options)

    def _token_in_query(self) -> bool:
        #  A keyless client has no token to put in the query either, and an
        #  empty `?token=` is a credential the server then rejects.
        return bool(self.sse_token_in_query and self.api_key)

    @staticmethod
    def _minted(answer: Any) -> str:
        token = answer.get("token") if isinstance(answer, dict) else None
        if not isinstance(token, str) or not token:
            raise DecodeError(f"POST {SSE_TOKENS} answered without a token", path="$.token", body=answer)
        return token

    def _stream_timeout(self, options: RequestOptions, read: Optional[float]) -> httpx.Timeout:
        #  A timeout on the whole response would cut the very stream it is
        #  for; the read timeout is the inactivity watchdog, when there is one.
        connect = options.timeout if options.timeout is not None else self.timeout
        return httpx.Timeout(connect, read=read)

    @staticmethod
    def _retryable(method: str, idempotency_key: Optional[str]) -> bool:
        #  Reads are always safe to repeat; writes only when the server can
        #  recognise the repeat.
        return method in ("GET", "HEAD") or idempotency_key is not None

    @staticmethod
    def _decode(response: httpx.Response, expected: Response) -> Any:
        if expected.kind == "void" or response.status_code == 204:
            return None
        if expected.kind == "binary":
            return response.content
        if expected.kind == "text":
            return response.text
        content = response.content
        if not content:
            if expected.nullable:
                return None
            #  An empty 200 where a body was promised is not an answer.
            raise DecodeError(f"{response.status_code} with an empty body, where a JSON body was expected")
        try:
            parsed = json.loads(content)
        except ValueError as error:
            raise DecodeError(f"the response is not JSON: {error}", body=content.decode("utf-8", "replace")) from None
        if parsed is None and expected.nullable:
            return None
        if expected.type is None:
            return parsed
        try:
            return decode(expected.type, parsed)
        except DecodeError as error:
            error.body = parsed
            raise


def _set_all(headers: Dict[str, str], pairs: Iterable[Tuple[str, str]]) -> None:
    for name, value in pairs:
        _remove(headers, name)
        headers[name] = value


def _remove(headers: Dict[str, str], name: str) -> None:
    for existing in [key for key in headers if key.lower() == name.lower()]:
        del headers[existing]


def _error(response: httpx.Response, body: bytes) -> APIError:
    return error_for_status(response.status_code, problem_from_bytes(response.status_code, body), response.headers)


def _should_retry(response: httpx.Response, can_retry: bool, attempt: int, retries: int) -> bool:
    return (
        response.status_code in _RETRYABLE
        and response.headers.get("x-should-retry") != "false"
        and can_retry
        and attempt < retries
    )


class SyncTransport(BaseClient):
    """The blocking send loop, over an `httpx.Client`."""

    def __init__(self, *args: Any, http_client: Optional[httpx.Client] = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._owns_http = http_client is None
        self._http = http_client or httpx.Client(follow_redirects=True)

    def close(self) -> None:
        """Close the connection pool, when this client created it."""
        if self._owns_http:
            self._http.close()

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: Sequence[Tuple[str, Any]] = (),
        headers: Sequence[Tuple[str, Any]] = (),
        body: Optional[Body] = None,
        idempotent: bool = False,
        response: Response = Response(),
        request_options: Optional[RequestOptions] = None,
    ) -> Any:
        options = self._options.merged(request_options)
        retries = options.max_retries if options.max_retries is not None else self.max_retries
        timeout = options.timeout if options.timeout is not None else self.timeout
        key = self._idempotency_key(idempotent, options)
        can_retry = self._retryable(method, key)
        encoded = _encode_body(body)
        url = self._url(path, query, options)
        request_headers = self._headers("application/json", headers, key, encoded.content_type, options)

        attempt = 0
        while True:
            request = self._http.build_request(
                method, url, headers=request_headers, content=encoded.content, timeout=timeout
            )
            try:
                answer = self._http.send(request)
            except httpx.TransportError as error:
                mapped: APIConnectionError = (
                    APITimeoutError(f"Request timed out after {timeout} s")
                    if isinstance(error, httpx.TimeoutException)
                    else APIConnectionError(f"Connection error: {error}")
                )
                if not can_retry or attempt >= retries:
                    raise mapped from error
                time.sleep(backoff_delay(attempt))
                attempt += 1
                continue
            if answer.is_success:
                return self._decode(answer, response)
            if not _should_retry(answer, can_retry, attempt, retries):
                raise _error(answer, answer.content)
            wait = parse_retry_after(answer.headers)
            time.sleep(min(wait if wait is not None else backoff_delay(attempt), 60.0))
            attempt += 1

    def _stream(
        self,
        path: str,
        *,
        query: Sequence[Tuple[str, Any]] = (),
        headers: Sequence[Tuple[str, Any]] = (),
        request_options: Optional[RequestOptions] = None,
    ) -> EventStream:
        options = self._options.merged(request_options)
        stream = options.stream or StreamOptions()
        timeout = self._stream_timeout(options, stream.inactivity_timeout)

        def connect(last_event_id: Optional[str]) -> httpx.Response:
            #  The query carries a 60-second token minted for this connection,
            #  never the API key: a URL ends up in proxy and access logs that
            #  mask no query string. Each reconnect mints its own.
            pairs = list(query)
            if self._token_in_query():
                pairs.append(("token", self._minted(self._request("POST", SSE_TOKENS, idempotent=True))))
            request = self._http.build_request(
                "GET",
                self._url(path, pairs, options),
                headers=self._stream_headers(headers, last_event_id, options),
                timeout=timeout,
            )
            return self._http.send(request, stream=True)

        return EventStream(reconnecting(connect, stream))

    def _stream_post(
        self,
        path: str,
        body: Any,
        *,
        query: Sequence[Tuple[str, Any]] = (),
        headers: Sequence[Tuple[str, Any]] = (),
        idempotent: bool = True,
        request_options: Optional[RequestOptions] = None,
    ) -> EventStream:
        options = self._options.merged(request_options)
        #  The key every POST carries, chosen once: there is no second attempt
        #  for it to be reused by, but the bytes must match any other POST.
        key = self._idempotency_key(idempotent, options)
        encoded = _encode_body(Body(body))
        url = self._url(path, query, options)
        request_headers = self._headers("text/event-stream", headers, key, encoded.content_type, options)
        timeout = self._stream_timeout(options, None)

        def send() -> httpx.Response:
            request = self._http.build_request(
                "POST", url, headers=request_headers, content=encoded.content, timeout=timeout
            )
            return self._http.send(request, stream=True)

        return EventStream(single(send))


class AsyncTransport(BaseClient):
    """The asyncio send loop, over an `httpx.AsyncClient`."""

    def __init__(self, *args: Any, http_client: Optional[httpx.AsyncClient] = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._owns_http = http_client is None
        self._http = http_client or httpx.AsyncClient(follow_redirects=True)

    async def aclose(self) -> None:
        """Close the connection pool, when this client created it."""
        if self._owns_http:
            await self._http.aclose()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        query: Sequence[Tuple[str, Any]] = (),
        headers: Sequence[Tuple[str, Any]] = (),
        body: Optional[Body] = None,
        idempotent: bool = False,
        response: Response = Response(),
        request_options: Optional[RequestOptions] = None,
    ) -> Any:
        options = self._options.merged(request_options)
        retries = options.max_retries if options.max_retries is not None else self.max_retries
        timeout = options.timeout if options.timeout is not None else self.timeout
        key = self._idempotency_key(idempotent, options)
        can_retry = self._retryable(method, key)
        encoded = _encode_body(body)
        url = self._url(path, query, options)
        request_headers = self._headers("application/json", headers, key, encoded.content_type, options)

        attempt = 0
        while True:
            request = self._http.build_request(
                method, url, headers=request_headers, content=encoded.content, timeout=timeout
            )
            try:
                answer = await self._http.send(request)
            except httpx.TransportError as error:
                mapped: APIConnectionError = (
                    APITimeoutError(f"Request timed out after {timeout} s")
                    if isinstance(error, httpx.TimeoutException)
                    else APIConnectionError(f"Connection error: {error}")
                )
                if not can_retry or attempt >= retries:
                    raise mapped from error
                await asyncio.sleep(backoff_delay(attempt))
                attempt += 1
                continue
            if answer.is_success:
                return self._decode(answer, response)
            if not _should_retry(answer, can_retry, attempt, retries):
                raise _error(answer, answer.content)
            wait = parse_retry_after(answer.headers)
            await asyncio.sleep(min(wait if wait is not None else backoff_delay(attempt), 60.0))
            attempt += 1

    def _stream(
        self,
        path: str,
        *,
        query: Sequence[Tuple[str, Any]] = (),
        headers: Sequence[Tuple[str, Any]] = (),
        request_options: Optional[RequestOptions] = None,
    ) -> AsyncEventStream:
        options = self._options.merged(request_options)
        stream = options.stream or StreamOptions()
        timeout = self._stream_timeout(options, stream.inactivity_timeout)

        async def connect(last_event_id: Optional[str]) -> httpx.Response:
            #  See the blocking transport: a minted token, never the key.
            pairs = list(query)
            if self._token_in_query():
                pairs.append(("token", self._minted(await self._request("POST", SSE_TOKENS, idempotent=True))))
            request = self._http.build_request(
                "GET",
                self._url(path, pairs, options),
                headers=self._stream_headers(headers, last_event_id, options),
                timeout=timeout,
            )
            return await self._http.send(request, stream=True)

        return AsyncEventStream(areconnecting(connect, stream))

    def _stream_post(
        self,
        path: str,
        body: Any,
        *,
        query: Sequence[Tuple[str, Any]] = (),
        headers: Sequence[Tuple[str, Any]] = (),
        idempotent: bool = True,
        request_options: Optional[RequestOptions] = None,
    ) -> AsyncEventStream:
        options = self._options.merged(request_options)
        key = self._idempotency_key(idempotent, options)
        encoded = _encode_body(Body(body))
        url = self._url(path, query, options)
        request_headers = self._headers("text/event-stream", headers, key, encoded.content_type, options)
        timeout = self._stream_timeout(options, None)

        async def send() -> httpx.Response:
            request = self._http.build_request(
                "POST", url, headers=request_headers, content=encoded.content, timeout=timeout
            )
            return await self._http.send(request, stream=True)

        return AsyncEventStream(asingle(send))


__all__ = [
    "BINARY",
    "TEXT",
    "VOID",
    "AsyncTransport",
    "Body",
    "Event",
    "RequestOptions",
    "Response",
    "SyncTransport",
]
