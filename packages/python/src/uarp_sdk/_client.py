"""`Client` and `AsyncClient`: the transport plus every resource group."""

from __future__ import annotations

import copy
from typing import Any, Mapping, Optional, Sequence, Tuple, cast

from ._sse import AsyncEventStream, EventStream, StreamOptions
from ._transport import AsyncTransport, Body, RequestOptions, Response, SyncTransport
from .generated.resources import AsyncResources, SyncResources


class Client(SyncTransport, SyncResources):
    """Client for the UARP platform API.

        from uarp_sdk import Client

        client = Client()  # reads UARP_API_KEY
        page = client.agents.list(limit=10)
        for agent in client.agents.list_all():
            print(agent.name)

    Every resource group is an attribute (`client.agents`, `client.runs`, …).
    Close the client, or use it as a context manager, to release its
    connections.
    """

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def with_options(
        self,
        *,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        headers: Optional[Mapping[str, Optional[str]]] = None,
        query: Optional[Mapping[str, Any]] = None,
        stream: Optional[StreamOptions] = None,
    ) -> "Client":
        """A copy of this client that applies these options to every call made through it.

        The connection pool is shared with this client, so it is cheap. There is
        no `idempotency_key` here: one key on every write would make the server
        answer each create after the first as a replay of it. Pass it per call in
        `RequestOptions`.
        """
        return cast("Client", _with_options(self, timeout, max_retries, headers, query, stream))

    def request(
        self,
        method: str,
        path: str,
        *,
        body: Any = None,
        query: Sequence[Tuple[str, Any]] = (),
        request_options: Optional[RequestOptions] = None,
    ) -> Any:
        """Call an endpoint the generated surface does not cover; returns the parsed JSON.

        A write gets an `Idempotency-Key`, as every generated write does.
        """
        method = method.upper()
        return self._request(
            method,
            path,
            query=query,
            body=None if body is None else Body(body),
            idempotent=method != "GET" and method != "HEAD",
            response=Response(nullable=True),
            request_options=request_options,
        )

    def stream_post(self, path: str, body: Any, *, request_options: Optional[RequestOptions] = None) -> EventStream:
        """POST a JSON body and read the answer as server-sent events.

        An LLM completion with `"stream": true`: the platform cuts a silent
        non-streamed request at 120 s; a streamed one keeps the connection
        alive for minutes.

            for event in client.stream_post("/api/v1/llm/chat/completions", body):
                print(event.json()["choices"][0]["delta"].get("content", ""), end="")

        Exactly one attempt: no retry and no reconnect, whatever the status,
        since a replay would run, and bill, the model twice. The stream ends on
        `data: [DONE]` (not delivered), at the end of the body, or when the
        caller stops. A non-2xx answer raises the `APIError` for its status,
        with the problem document; so does a 2xx that is not
        `text/event-stream`. A connection that breaks after the stream began
        raises `APIConnectionError`.
        """
        return self._stream_post(path, body, request_options=request_options)


class AsyncClient(AsyncTransport, AsyncResources):
    """Client for the UARP platform API, for asyncio.

        from uarp_sdk import AsyncClient

        async with AsyncClient() as client:
            page = await client.agents.list(limit=10)
            async for agent in client.agents.list_all():
                print(agent.name)
    """

    async def __aenter__(self) -> "AsyncClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    def with_options(
        self,
        *,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        headers: Optional[Mapping[str, Optional[str]]] = None,
        query: Optional[Mapping[str, Any]] = None,
        stream: Optional[StreamOptions] = None,
    ) -> "AsyncClient":
        """A copy of this client that applies these options to every call made through it."""
        return cast("AsyncClient", _with_options(self, timeout, max_retries, headers, query, stream))

    async def request(
        self,
        method: str,
        path: str,
        *,
        body: Any = None,
        query: Sequence[Tuple[str, Any]] = (),
        request_options: Optional[RequestOptions] = None,
    ) -> Any:
        """Call an endpoint the generated surface does not cover; returns the parsed JSON."""
        method = method.upper()
        return await self._request(
            method,
            path,
            query=query,
            body=None if body is None else Body(body),
            idempotent=method != "GET" and method != "HEAD",
            response=Response(nullable=True),
            request_options=request_options,
        )

    def stream_post(
        self, path: str, body: Any, *, request_options: Optional[RequestOptions] = None
    ) -> AsyncEventStream:
        """POST a JSON body and read the answer as server-sent events; see `Client.stream_post`."""
        return self._stream_post(path, body, request_options=request_options)


def _with_options(
    client: Any,
    timeout: Optional[float],
    max_retries: Optional[int],
    headers: Optional[Mapping[str, Optional[str]]],
    query: Optional[Mapping[str, Any]],
    stream: Optional[StreamOptions],
) -> Any:
    clone = copy.copy(client)
    #  The resource groups are cached per instance and bound to it; the copy
    #  builds its own, bound to the copy.
    for name in list(vars(clone)):
        if not name.startswith("_") and name not in _CONFIG:
            del clone.__dict__[name]
    clone._owns_http = False
    clone._options = client._options.merged(
        RequestOptions(
            timeout=timeout,
            max_retries=max_retries,
            headers=dict(headers or {}),
            query=dict(query or {}),
            stream=stream,
        )
    )
    return clone


#: The public attributes a client sets in `__init__`, kept by a copy.
_CONFIG = frozenset(
    ("api_key", "base_url", "timeout", "max_retries", "default_headers", "user_agent", "sse_token_in_query")
)

__all__ = ["AsyncClient", "Client"]
