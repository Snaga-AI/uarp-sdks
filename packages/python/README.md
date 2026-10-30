# uarp-sdk

Python client for the **UARP — Universal Agent Runtime Platform** API. Every
operation the API describes, as typed methods on a blocking `Client` and an
asyncio `AsyncClient`, built on `httpx`.

```sh
pip install uarp-sdk
```

Python 3.10+. The one dependency is `httpx`.

## Quick start

```python
from uarp_sdk import Client
from uarp_sdk.models import CreateAgentRequest

with Client() as client:  # UARP_API_KEY (or SNAGA_API_KEY), UARP_BASE_URL
    # The platform selects the model itself, so a create is just a name.
    agent = client.agents.create(CreateAgentRequest(name="demo"))
    print(agent.agent_id, agent.name)
```

**Getting a key.** Sign in at <https://snaga.ai> and create one in your tenant's
settings. A key looks like `uarp_<prefix>_<secret>`; the secret half is shown
once and never again. With a key that carries `tenants:write` you can mint more
through `POST /api/v1/tenants/me/keys`. Give each one the narrowest set of
scopes that does its job.

Resource groups are attributes: `client.agents`, `client.runs`,
`client.sessions`, … one for each tag in the API description. Path parameters
and the body are positional; query and header parameters are keyword-only:

```python
page = client.agents.list(limit=20, include_offline=False)
for agent in page.items:
    print(agent.name, agent.status)
```

The same surface, awaited:

```python
import asyncio

from uarp_sdk import AsyncClient


async def main() -> None:
    async with AsyncClient() as client:
        page = await client.agents.list(limit=20)
        print(len(page.items))


asyncio.run(main())
```

## Models

Every body the document describes is a keyword-only dataclass in
`uarp_sdk.models`, and every enum a `str` enum.

- A property the document marks required has no default, so leaving it out of a
  body you build is a `TypeError` rather than a request the server refuses.
  Everything else defaults to `None`.
- Responses are decoded strictly: a required member that is absent, or a value
  of the wrong type, raises `DecodeError` naming the path (`$.items[3].status`).
  The parsed body is still on the error, as `error.body`.
- A member the document does not name is ignored, except on the models the
  document declares open, which keep it in `additional_properties`.
- An enum value the server adds later still decodes: it is an instance of the
  enum that is not one of its members, carries the value as sent, and reports
  `is_known` as `False`. Members compare equal to their wire values.
- An optional property left at `None` is not sent. To send an explicit `null`,
  pass the body as a plain `dict`, which goes on the wire as it is:

```python
client.agents.update(agent_id, {"description": None})
```

- A property whose wire name is a Python keyword gets a trailing underscore
  (`from` is `from_`); `to_dict()` and `from_dict()` use the wire names.
- Timestamps are `str` (ISO-8601). `oneOf` bodies are plain JSON values.

## Streaming

SSE endpoints return an `EventStream`, which reconnects with `Last-Event-ID`
when the connection ends. Iterate it; leaving the `with` block, or `close()`,
ends it.

```python
with client.runs.stream_run_events(run_id) as events:
    for event in events:
        # The reply's text is `payload.delta` on chunks whose
        # `payload.chunk_type` is "content"; "thinking" and "tool_call" chunks
        # carry the model's reasoning and tool calls, which are not the answer.
        if event.event == "llm.chunk":
            payload = event.json()["payload"]
            if payload.get("chunk_type", "content") == "content":
                print(payload.get("delta", ""), end="")
        if event.event == "run.completed":
            break
```

`AsyncClient` returns an `AsyncEventStream`, iterated with `async for`.
Reconnection, terminal events, an inactivity watchdog and a lifecycle callback
are set with `StreamOptions`:

```python
from uarp_sdk import RequestOptions, StreamOptions, StreamState

options = StreamOptions(
    terminal_events=frozenset({"run.completed", "run.failed"}),
    inactivity_timeout=300.0,
    on_state=lambda state, attempt: print(state, attempt),
)
for event in client.runs.stream_run_events(run_id, request_options=RequestOptions(stream=options)):
    print(event.event)
```

An answer streamed to a POST, such as an LLM completion with `"stream": true`,
uses `stream_post`. Stream long completions: the platform cuts a non-streamed
one that stays silent for 120 s.

```python
completion = {
    "model": "my-model",
    "stream": True,
    "messages": [{"role": "user", "content": "hi"}],
}
for event in client.stream_post("/api/v1/llm/chat/completions", completion):
    print(event.json()["choices"][0]["delta"].get("content", ""), end="")
# ends after `data: [DONE]`, which is not delivered
```

It makes one attempt: no retry and no reconnect, whatever the status, because
replaying the POST would run, and bill, the model twice. A refusal raises the
`APIError` for its status. A 2xx that is not `text/event-stream` (say, plain
JSON because `"stream": true` was left out) raises an `APIError` with the
status as received, not an empty stream.

## Pagination

```python
for agent in client.agents.list_all(limit=100):
    print(agent.name)
```

`list_all` follows the cursor until the server reports no further pages, and
stops if a server ever repeats a cursor. On `AsyncClient` it is an async
iterator: `async for agent in client.agents.list_all()`.

An empty page does **not** end the walk. This API applies the page limit before
filtering, so a page can come back with no items and more behind it. Three
empty pages in a row do stop it, so a filter that matches rarely can end the
walk before the last match. When every row matters, page by hand: call `list`
with the `cursor` it returned until `has_more` is false.

## Errors

```python
from uarp_sdk import APIError, APITimeoutError, NotFoundError, RateLimitError, UnprocessableEntityError

try:
    client.agents.get("missing")
except NotFoundError:
    print("no such agent")
except UnprocessableEntityError as error:
    print(error.validation_errors)
except RateLimitError as error:
    print("retry after", error.retry_after_seconds)
except APIError as error:
    print(error.status, error.code, error.reason, error.correlation_id)
except APITimeoutError:
    print("timed out")
```

`APIError` carries the status, the parsed problem document (`error.problem`),
the response headers, `code` — the stable value to switch on, such as
`SESSION_NOT_ACTIVE`, where `detail` is prose that can change — `reason` when
the code alone does not say why (a refused `X-Active-Tenant` answers `FORBIDDEN`
with `not_a_member` or `membership_suspended`), and `correlation_id` for
support. Every other member the server sent is in `error.problem.extensions`.
A body that is not a problem document — a bare `{"error": "..."}`, an HTML page
from a proxy — still reaches `error.problem.detail`.

Everything the SDK raises derives from `UarpError`: `APIError` and its
subclasses per status, `APIConnectionError` (and `APITimeoutError`),
`DecodeError`, `EncodeError` and `ConfigError`.

## Configuration

```python
client = Client(
    api_key="uarp_...",              # else UARP_API_KEY / SNAGA_API_KEY
    base_url="https://api.snaga.ai",  # else UARP_BASE_URL
    timeout=60.0,                     # seconds, per request
    max_retries=2,
    default_headers={"X-Team": "growth"},
    user_agent="my-app/1.0",          # appended to the SDK's own
)
```

An omitted key raises `ConfigError`. An explicit `api_key=""` is a client with
no credentials of its own: it sends no `Authorization` header at all. Pass
`http_client=httpx.Client(...)` for proxies, custom TLS or instrumentation.

Transient failures (`408`, `429`, `5xx`, dropped connections) are retried
with jittered backoff, honouring `Retry-After` and `X-Should-Retry: false`.
Reads always retry; writes only when they carry an `Idempotency-Key`, which
every mutating `/api/v1/*` call sends automatically.

### Per-call overrides

```python
from uarp_sdk import RequestOptions

agent = client.agents.get(id, request_options=RequestOptions(timeout=5.0, max_retries=0))

# Reuse a key to replay a create safely.
client.agents.create(body, request_options=RequestOptions(idempotency_key="order-4711"))

# Or bind options to a copy of the client; the connection pool is shared.
traced = client.with_options(headers={"X-Trace-Id": trace_id})
traced.agents.list()
```

## Escape hatch

```python
value = client.request("POST", "/api/v1/experimental/thing", body={"a": 1})
```

## Development

```sh
uv run pytest
uv run mypy
```

Files under `src/uarp_sdk/generated/` come from `generator/` in
[Snaga-AI/uarp-sdks](https://github.com/Snaga-AI/uarp-sdks); edit the emitter,
not the output.
