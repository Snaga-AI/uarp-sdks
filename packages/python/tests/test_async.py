"""`AsyncClient`: the same wire behaviour as `Client`, through asyncio."""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, List

import pytest

from conftest import Received, Reply, Server, agent_json
from uarp_sdk import APIError, AsyncClient, NotFoundError, RateLimitError, RequestOptions, StreamOptions
from uarp_sdk.models import CreateAgentRequest


def run(body: Callable[[AsyncClient], Awaitable[Any]], server: Server, **options: Any) -> Any:
    async def main() -> Any:
        options.setdefault("max_retries", 0)
        async with AsyncClient(api_key="uarp_test1234_secret", base_url=server.url, **options) as client:
            return await body(client)

    return asyncio.run(main())


def test_a_call_carries_the_same_headers(server: Server) -> None:
    server.route = lambda request: Reply.json({"items": [], "cursor": None, "has_more": False})
    page = run(lambda client: client.agents.list(limit=0, include_offline=False), server)
    assert page.has_more is False
    (request,) = server.received
    assert request.query == "limit=0&include_offline=false"
    assert request.headers["authorization"] == "Bearer uarp_test1234_secret"
    assert request.headers["user-agent"].startswith("uarp-sdk-python/")


def test_a_429_is_retried_with_the_same_key(server: Server) -> None:
    def route(request: Received) -> Reply:
        if len(server.received) == 1:
            return Reply.json({"status": 429}, 429, (("Retry-After", "0"),))
        return Reply.json(agent_json(), 201)

    server.route = route
    agent = run(lambda client: client.agents.create(CreateAgentRequest(name="demo")), server, max_retries=2)
    assert agent.agent_id == "a1"
    first, second = server.received
    assert first.headers["idempotency-key"] == second.headers["idempotency-key"]


def test_a_404_is_typed_and_not_retried(server: Server) -> None:
    server.route = lambda request: Reply.json({"title": "Not Found", "status": 404}, 404)
    with pytest.raises(NotFoundError):
        run(lambda client: client.agents.get("missing"), server, max_retries=2)
    assert len(server.received) == 1


def test_list_all_follows_the_cursor(server: Server) -> None:
    def route(request: Received) -> Reply:
        if "cursor=next" in request.query:
            return Reply.json({"items": [agent_json("a2")], "cursor": None, "has_more": False})
        return Reply.json({"items": [agent_json("a1")], "cursor": "next", "has_more": True})

    server.route = route

    async def walk(client: AsyncClient) -> List[str]:
        return [agent.agent_id async for agent in client.agents.list_all()]

    assert run(walk, server) == ["a1", "a2"]


def test_a_stream_reconnects_with_the_last_event_id(server: Server) -> None:
    def route(request: Received) -> Reply:
        if len(server.received) == 1:
            return Reply.events(b"id: 5\ndata: first\n\n")
        return Reply.events(b"id: 6\nevent: run.completed\ndata: second\n\n")

    server.route = route
    options = StreamOptions(base_retry=0.001, max_backoff=0.002, terminal_events=frozenset({"run.completed"}))

    async def read(client: AsyncClient) -> List[str]:
        stream = client.runs.stream_run_events("r1", request_options=RequestOptions(stream=options))
        return [event.data async for event in stream]

    assert run(read, server) == ["first", "second"]
    assert server.received[1].headers["last-event-id"] == "5"


def test_stream_post_stops_at_done_and_never_retries(server: Server) -> None:
    server.route = lambda request: Reply.events(b"data: one\n\n", b"data: [DONE]\n\n")

    async def read(client: AsyncClient) -> List[str]:
        return [event.data async for event in client.stream_post("/api/v1/llm/chat/completions", {"stream": True})]

    assert run(read, server) == ["one"]

    server.received.clear()
    server.route = lambda request: Reply.json({"status": 429, "detail": "quota"}, 429, (("Retry-After", "0"),))

    async def refused(client: AsyncClient) -> None:
        async for _ in client.stream_post("/api/v1/llm/chat/completions", {"stream": True}):
            pass

    with pytest.raises(RateLimitError):
        run(refused, server, max_retries=3)
    assert len(server.received) == 1


def test_a_stream_post_answered_with_plain_json_is_an_error(server: Server) -> None:
    server.route = lambda request: Reply.json({"choices": []})

    async def read(client: AsyncClient) -> None:
        async for _ in client.stream_post("/api/v1/llm/chat/completions", {}):
            pass

    with pytest.raises(APIError) as caught:
        run(read, server)
    assert caught.value.status == 200
