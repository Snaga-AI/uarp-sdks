"""The transport, exercised through generated methods against a real local server."""

from __future__ import annotations

import itertools
import json
import re
from typing import Any, List

import pytest

from conftest import Received, Reply, Server, agent_json
from uarp_sdk import (
    APIConnectionError,
    APIError,
    Client,
    ConfigError,
    DecodeError,
    FilePart,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
    RequestOptions,
    StreamOptions,
    StreamState,
    UnprocessableEntityError,
)
from uarp_sdk.models import (
    CompleteOAuthLoginFormPostProvider,
    CompleteOAuthLoginFormPostRequest,
    CreateAgentRequest,
    CreateRunRequest,
    RegistryPublishRequest,
    RunStatus,
)

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
EMPTY_PAGE = {"items": [], "cursor": None, "has_more": False}


def client_for(server: Server, **options: Any) -> Client:
    options.setdefault("api_key", "uarp_test1234_secret")
    options.setdefault("max_retries", 0)
    return Client(base_url=server.url, **options)


# ------------------------------------------------------------------ requests


def test_sends_auth_and_user_agent(server: Server) -> None:
    server.route = lambda request: Reply.json(EMPTY_PAGE)
    page = client_for(server).agents.list()
    assert page.items == []
    (request,) = server.received
    assert request.method == "GET"
    assert request.path == "/api/v1/agents"
    assert request.headers["authorization"] == "Bearer uarp_test1234_secret"
    assert request.headers["accept"] == "application/json"
    assert re.fullmatch(r"uarp-sdk-python/\d+\.\d+\.\d+\S*", request.headers["user-agent"])


def test_serialises_query_parameters_and_skips_none(server: Server) -> None:
    server.route = lambda request: Reply.json(EMPTY_PAGE)
    client_for(server).agents.list(limit=0, include_offline=False, cursor=None)
    #  Zero and false are values, not absences; `None` is left out.
    assert server.received[0].query == "limit=0&include_offline=false"


def test_query_encoding_is_strict(server: Server) -> None:
    server.route = lambda request: Reply.json(EMPTY_PAGE)
    client_for(server).agents.list(workspace_id="ы w&x=y+z*!()~")
    assert server.received[0].query == "workspace_id=%D1%8B%20w%26x%3Dy%2Bz%2A%21%28%29~"


def test_repeats_the_key_for_each_item_of_an_array_query_parameter(server: Server) -> None:
    server.route = lambda request: Reply.json(
        {
            "careers": {"enabled": True, "title": "t", "description": "d", "company_name": "c"},
            "items": [],
            "facets": {
                "categories": [], "departments": [], "workplace_types": [], "employment_types": [],
                "seniorities": [], "countries": [], "cities": [],
            },
            "total": 0, "page": 1, "limit": 20, "total_pages": 0,
        }
    )
    client_for(server).public.list_public_jobs(country=["UA", "PL"], q="a b")
    assert server.received[0].query == "country=UA&country=PL&q=a%20b"


def test_percent_encodes_path_parameters(server: Server) -> None:
    server.route = lambda request: Reply.json(agent_json())
    client = client_for(server)
    client.agents.get("id with/slash")
    client.agents.get("агент")
    raw = [request.path for request in server.received]
    assert raw == ["/api/v1/agents/id%20with%2Fslash", "/api/v1/agents/%D0%B0%D0%B3%D0%B5%D0%BD%D1%82"]


def test_attaches_an_idempotency_key_to_writes_only(server: Server) -> None:
    server.route = lambda request: Reply.json(agent_json() if request.method == "POST" else EMPTY_PAGE, 201)
    client = client_for(server)
    client.agents.create(CreateAgentRequest(name="demo"))
    client.agents.list()
    write, read = server.received
    assert UUID.match(write.headers["idempotency-key"])
    assert "idempotency-key" not in read.headers


def test_sends_a_json_body_without_the_optional_fields_left_unset(server: Server) -> None:
    server.route = lambda request: Reply.json(agent_json(), 201)
    client_for(server).agents.create(CreateAgentRequest(name="demo"))
    (request,) = server.received
    assert request.headers["content-type"] == "application/json"
    assert request.json() == {"name": "demo"}


def test_a_json_body_escapes_what_it_must_and_keeps_a_zero(server: Server) -> None:
    awkward = '"q" \\ \n \t ы 😀'
    server.route = lambda request: Reply.json(
        {"run_id": "r1", "tenant_id": "t1", "agent_id": "a1", "status": "queued", "created_at": "x"}, 201
    )
    client_for(server).runs.create(CreateRunRequest(agent_id=awkward, session_id="", version=0))
    assert server.received[0].json() == {"agent_id": awkward, "session_id": "", "version": 0}


def test_a_dict_body_goes_on_the_wire_as_it_is(server: Server) -> None:
    #  The way to send an explicit null for an optional property.
    server.route = lambda request: Reply.json(agent_json(), 201)
    client_for(server).agents.create({"name": "demo", "description": None})
    assert server.received[0].json() == {"name": "demo", "description": None}


def test_a_form_body_goes_on_the_wire_as_url_search_params_would_write_it(server: Server) -> None:
    server.route = lambda request: Reply.json({"api_key": "k", "email": "a@b.c"})
    signed_in = client_for(server).auth.complete_o_auth_login_form_post(
        CompleteOAuthLoginFormPostProvider.APPLE,
        CompleteOAuthLoginFormPostRequest(user='{"name":"А Б","email":"a@b.c"}', state="s/ы&=~*", code="c 1+2"),
    )
    assert signed_in.email == "a@b.c"
    (request,) = server.received
    assert request.headers["content-type"] == "application/x-www-form-urlencoded"
    #  The bytes contract/SCENARIOS.md expects for scenario 20: schema order,
    #  whatever order the caller named them in.
    assert request.body == (
        b"code=c+1%2B2&state=s%2F%D1%8B%26%3D%7E*"
        b"&user=%7B%22name%22%3A%22%D0%90+%D0%91%22%2C%22email%22%3A%22a%40b.c%22%7D"
    )


def test_a_form_body_given_as_a_dict_is_still_sent_in_schema_order(server: Server) -> None:
    server.route = lambda request: Reply.json({"api_key": "k", "email": "a@b.c"})
    client_for(server).auth.complete_o_auth_login_form_post(
        CompleteOAuthLoginFormPostProvider.APPLE, {"user": "u", "state": "s", "code": "c"}
    )
    assert server.received[0].body == b"code=c&state=s&user=u"


def test_builds_a_multipart_body(server: Server) -> None:
    server.route = lambda request: Reply.json(
        {
            "scope": "@demo", "name": "bundle", "version": "1.0.0", "publisher_tenant_id": "t1",
            "manifest": {"name": "demo"}, "sha256": "abc123", "size_bytes": 3, "visibility": "public",
            "published_at": "2026-01-01T00:00:00Z",
        },
        201,
    )
    client_for(server).registry.registry_publish(
        RegistryPublishRequest(
            manifest='{"name":"demo"}',
            artifact=FilePart(data=b"\x00\xffA", filename="bundle.tar.zst", content_type="application/zstd"),
        )
    )
    (request,) = server.received
    boundary = request.headers["content-type"].split("boundary=")[1]
    assert request.headers["content-type"].startswith("multipart/form-data; boundary=")
    assert request.body == (
        f'--{boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n{{"name":"demo"}}\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="artifact"; filename="bundle.tar.zst"\r\n'
        f"Content-Type: application/zstd\r\n\r\n"
    ).encode() + b"\x00\xffA" + f"\r\n--{boundary}--\r\n".encode()


def test_downloads_bytes_verbatim(server: Server) -> None:
    payload = bytes([0x00, 0xFF, 0x41, 0x00, 0x42])
    server.route = lambda request: Reply(200, payload, (("Content-Type", "application/octet-stream"),))
    assert client_for(server).files.download_file_content("f1") == payload


def test_a_204_is_none(server: Server) -> None:
    server.route = lambda request: Reply(204, b"")
    assert client_for(server).files.delete("f1") is None
    assert server.received[0].method == "DELETE"


# ------------------------------------------------------------------ retries


def test_retries_a_429_and_honours_retry_after(server: Server) -> None:
    def route(request: Received) -> Reply:
        if len(server.received) == 1:
            return Reply.json({"title": "Too Many Requests", "status": 429}, 429, (("Retry-After", "0"),))
        return Reply.json(agent_json(), 201)

    server.route = route
    client_for(server, max_retries=2).agents.create(CreateAgentRequest(name="demo"))
    first, second = server.received
    #  The retry is the same write: same key, same body.
    assert first.headers["idempotency-key"] == second.headers["idempotency-key"]
    assert first.body == second.body


def test_does_not_retry_a_write_that_carries_no_idempotency_key(server: Server) -> None:
    #  The OpenAI-compatible routes take no `Idempotency-Key`, so the server
    #  cannot recognise a repeat: a retried embedding would be billed twice.
    server.route = lambda request: Reply.json({"title": "Unavailable", "status": 503}, 503, (("Retry-After", "0"),))
    with pytest.raises(APIError) as caught:
        client_for(server, max_retries=3).open_ai_compat.embeddings({"model": "m", "input": "hi"})
    assert caught.value.status == 503
    assert len(server.received) == 1
    assert "idempotency-key" not in server.received[0].headers


def test_maps_a_404_to_a_typed_error_without_retrying(server: Server) -> None:
    server.route = lambda request: Reply.json({"title": "Not Found", "status": 404, "detail": "no such agent"}, 404)
    with pytest.raises(NotFoundError) as caught:
        client_for(server, max_retries=2).agents.get("missing")
    assert len(server.received) == 1
    assert caught.value.problem.detail == "no such agent"
    assert str(caught.value) == "404 Not Found — no such agent"


def test_does_not_retry_a_conflict_even_with_an_idempotency_key(server: Server) -> None:
    #  A conflict is the server's answer about the resource's state; the same
    #  request meets the same state. It used to be sent three times.
    server.route = lambda request: Reply.json(
        {"title": "Conflict", "status": 409, "code": "CLIENT_REQUEST_CONFLICT"}, 409, (("Retry-After", "0"),)
    )
    with pytest.raises(APIError) as caught:
        client_for(server, max_retries=2).agents.create(CreateAgentRequest(name="demo"))
    assert caught.value.status == 409
    assert not caught.value.is_retryable
    assert len(server.received) == 1


def test_honours_the_no_retry_hint(server: Server) -> None:
    server.route = lambda request: Reply.json({"status": 503}, 503, (("X-Should-Retry", "false"),))
    with pytest.raises(APIError):
        client_for(server, max_retries=2).agents.list()
    assert len(server.received) == 1


def test_surfaces_rate_limit_hints_from_the_headers(server: Server) -> None:
    server.route = lambda request: Reply.json(
        {"title": "Too Many Requests", "status": 429},
        429,
        (("Retry-After", "7"), ("X-RateLimit-Limit", "100"), ("X-RateLimit-Remaining", "0"), ("X-RateLimit-Reset", "1700000000")),
    )
    with pytest.raises(RateLimitError) as caught:
        client_for(server).agents.list()
    error = caught.value
    assert (error.retry_after_seconds, error.limit, error.remaining, error.reset) == (7.0, 100, 0, 1700000000)


def test_reuses_a_caller_supplied_idempotency_key(server: Server) -> None:
    server.route = lambda request: Reply.json(agent_json(), 201)
    client_for(server).agents.create(
        CreateAgentRequest(name="demo"), request_options=RequestOptions(idempotency_key="order-4711")
    )
    assert server.received[0].headers["idempotency-key"] == "order-4711"


def test_per_call_overrides_travel_on_a_copy(server: Server) -> None:
    server.route = lambda request: Reply.json(EMPTY_PAGE)
    client = client_for(server)
    tagged = client.with_options(headers={"X-Trace": "t-1"}, query={"debug": True})
    tagged.agents.list(limit=1)
    client.agents.list(limit=1)
    first, second = server.received
    assert first.headers["x-trace"] == "t-1"
    assert first.query == "limit=1&debug=true"
    assert "x-trace" not in second.headers
    assert second.query == "limit=1"


def test_a_copy_never_pins_one_idempotency_key_on_every_write(server: Server) -> None:
    #  One key on every write through a copy made the server answer the second
    #  create as a replay of the first.
    server.route = lambda request: Reply.json(agent_json(), 201)
    client = client_for(server)
    with pytest.raises(TypeError):
        client.with_options(idempotency_key="x")  # type: ignore[call-arg]
    tagged = client.with_options(headers={"X-Trace": "t-1"})
    tagged.agents.create(CreateAgentRequest(name="one"))
    tagged.agents.create(CreateAgentRequest(name="two"))
    first, second = server.received
    assert first.headers["idempotency-key"] != second.headers["idempotency-key"]


def test_an_image_upload_sends_raw_bytes_under_an_image_type(server: Server) -> None:
    #  It went out as JSON, which the server refuses with 415.
    server.route = lambda request: Reply.json({"file_id": "f1", "mime_type": "image/png", "size": 8}, 201)
    client = client_for(server)
    png = b"\x89PNG\r\n\x1a\n"
    client.public.upload_public_session_image("s1", png)
    client.public.upload_public_session_image("s1", FilePart(png, "a.png", "image/png"))
    bare, typed = server.received
    assert (bare.headers["content-type"], bare.body) == ("image/*", png)
    assert (typed.headers["content-type"], typed.body) == ("image/png", png)


def test_a_copy_can_turn_retries_off(server: Server) -> None:
    server.route = lambda request: Reply.json({"status": 503}, 503, (("Retry-After", "0"),))
    client = client_for(server, max_retries=2)
    with pytest.raises(APIError):
        client.with_options(max_retries=0).agents.list()
    assert len(server.received) == 1


def test_a_connection_that_is_refused_is_a_connection_error() -> None:
    client = Client(api_key="k", base_url="http://127.0.0.1:9", max_retries=0)
    with pytest.raises(APIConnectionError):
        client.agents.list()


# ----------------------------------------------------------------- decoding


def test_decodes_an_enum_value_it_has_never_seen(server: Server) -> None:
    server.route = lambda request: Reply.json(
        {"run_id": "r1", "tenant_id": "t1", "agent_id": "a1", "status": "brand_new_status", "created_at": "x"}
    )
    run = client_for(server).runs.get("r1")
    assert run.status == "brand_new_status"
    assert not run.status.is_known
    assert RunStatus("queued").is_known


def test_a_required_field_that_is_absent_fails_the_decode(server: Server) -> None:
    body = agent_json()
    del body["name"]
    server.route = lambda request: Reply.json(body)
    with pytest.raises(DecodeError) as caught:
        client_for(server).agents.get("a1")
    assert "`name`" in str(caught.value)
    #  The body is still reachable.
    assert caught.value.body == body


def test_a_value_of_the_wrong_type_fails_the_decode(server: Server) -> None:
    server.route = lambda request: Reply.json({**agent_json(), "name": None})
    with pytest.raises(DecodeError, match=r"\$\.name: expected a string, got null"):
        client_for(server).agents.get("a1")


def test_an_empty_200_where_a_body_was_promised_is_an_error(server: Server) -> None:
    server.route = lambda request: Reply(200, b"", (("Content-Type", "application/json"),))
    with pytest.raises(DecodeError, match="empty body"):
        client_for(server).agents.get("a1")


def test_a_schedule_that_is_not_set_is_none(server: Server) -> None:
    #  Real bytes: the 4-byte body `null` that GET /agents/{id}/schedule
    #  answered the canon tenant on 2026-10-15 (build b108e9a9) for an agent
    #  with no schedule.
    server.route = lambda request: Reply(200, b"null", (("Content-Type", "application/json"),))
    assert client_for(server).scheduler.get_schedule("a1") is None


# ------------------------------------------------------------------- errors

#  Real bytes, captured on production; see the Rust SDK's transport tests for
#  each one's provenance.
LIVE_401 = '{"type":"about:blank","title":"Unauthorized","status":401,"detail":"Missing Authorization header, token query parameter, or uarp_session cookie","correlationId":"sdk-probe-0001","correlation_id":"sdk-probe-0001","code":"AUTH_ERROR"}'
CANON_501 = '{"type": "about:blank", "title": "Not Implemented", "status": 501, "detail": "Artifact signing is disabled (spec_registry.signing_mode = \\"off\\").", "code": "SIGNING_NOT_CONFIGURED", "correlationId": "01a13c8d-1f16-732c-8884-727d6fb7bcdb"}'
SESSION_NOT_ACTIVE_422 = '{"type":"about:blank","title":"Validation Error","status":422,"detail":"Session is not active","correlationId":"01a13f4a-fb5a-7d99-9d94-910550f34d83","correlation_id":"01a13f4a-fb5a-7d99-9d94-910550f34d83","code":"SESSION_NOT_ACTIVE","session_status":"closed"}'
#  The 403 a refused X-Active-Tenant answers on production, build e0b37b03
#  (2026-10-17). membership_suspended is the API lane's capture from
#  handleRequest at d6b1c66e5, the same code: producing it on the wire would
#  mean suspending a membership on canon.
NOT_A_MEMBER_403 = '{"type":"about:blank","title":"Forbidden","status":403,"detail":"You are not a member of the active tenant requested by X-Active-Tenant","correlationId":"01a14b59-dd54-7a2f-aa6b-e4338e105419","correlation_id":"01a14b59-dd54-7a2f-aa6b-e4338e105419","code":"FORBIDDEN","reason":"not_a_member"}'
MEMBERSHIP_SUSPENDED_403 = '{"type":"about:blank","title":"Forbidden","status":403,"detail":"Your membership in the active tenant requested by X-Active-Tenant is suspended","correlationId":"01a14a66-dcfc-7a98-9221-f40af5b6cd0b","correlation_id":"01a14a66-dcfc-7a98-9221-f40af5b6cd0b","code":"FORBIDDEN","reason":"membership_suspended"}'
#  The same refusal on production, build d926b90e (2026-10-17), before
#  batch19: no code and no reason.
NOT_A_MEMBER_403_D926 = '{"type":"about:blank","title":"Forbidden","status":403,"detail":"You are not a member of the active tenant requested by X-Active-Tenant","correlationId":"01a14a66-337b-7324-9a2a-9354a8fc02c6","correlation_id":"01a14a66-337b-7324-9a2a-9354a8fc02c6"}'


def api_error_for(server: Server, status: int, body: str, request_id: str = "") -> APIError:
    headers = (("Content-Type", "application/problem+json"),)
    if request_id:
        headers += (("X-Request-Id", request_id),)
    server.route = lambda request: Reply(status, body.encode(), headers)
    with pytest.raises(APIError) as caught:
        client_for(server).agents.get("a1")
    return caught.value


def test_a_problem_keeps_its_code_and_request_id(server: Server) -> None:
    error = api_error_for(server, 401, LIVE_401, "sdk-probe-0001")
    assert error.code == "AUTH_ERROR"
    assert error.problem.correlation_id == "sdk-probe-0001"
    assert error.correlation_id == "sdk-probe-0001"
    assert error.problem.extensions == {}


def test_a_code_the_enum_does_not_list_still_reaches_the_caller(server: Server) -> None:
    error = api_error_for(server, 501, CANON_501)
    assert error.code == "SIGNING_NOT_CONFIGURED"
    assert error.correlation_id == "01a13c8d-1f16-732c-8884-727d6fb7bcdb"


def test_the_request_id_header_is_the_fallback(server: Server) -> None:
    body = '{"type":"about:blank","title":"Not Found","status":404,"detail":"no such agent"}'
    assert api_error_for(server, 404, body, "req-42").correlation_id == "req-42"


def test_an_extension_member_reaches_the_caller_beside_the_code(server: Server) -> None:
    error = api_error_for(server, 422, SESSION_NOT_ACTIVE_422)
    assert isinstance(error, UnprocessableEntityError)
    assert error.code == "SESSION_NOT_ACTIVE"
    assert error.problem.extensions == {"session_status": "closed"}


def test_the_reason_a_tenant_refused_the_caller_reaches_it_typed(server: Server) -> None:
    not_a_member = api_error_for(server, 403, NOT_A_MEMBER_403)
    assert isinstance(not_a_member, PermissionDeniedError)
    assert (not_a_member.code, not_a_member.reason) == ("FORBIDDEN", "not_a_member")
    assert api_error_for(server, 403, MEMBERSHIP_SUSPENDED_403).reason == "membership_suspended"
    before = api_error_for(server, 403, NOT_A_MEMBER_403_D926)
    assert (before.code, before.reason) == (None, None)


def test_a_bare_error_key_keeps_its_message(server: Server) -> None:
    error = api_error_for(server, 403, '{"error": "Insufficient role: owner required"}')
    assert error.problem.detail == "Insufficient role: owner required"
    assert "Insufficient role" in str(error)


def test_a_body_that_is_not_json_is_not_thrown_away(server: Server) -> None:
    error = api_error_for(server, 502, "<html><body>502 Bad Gateway</body></html>")
    assert "Bad Gateway" in (error.problem.detail or "")


def test_exposes_validation_errors(server: Server) -> None:
    body = json.dumps({"title": "Validation Error", "status": 422, "errors": [{"field": "name", "message": "required"}]})
    error = api_error_for(server, 422, body)
    assert [(entry.field, entry.message) for entry in error.validation_errors] == [("name", "required")]


# -------------------------------------------------------------- credentials


def test_a_missing_key_is_a_config_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("UARP_API_KEY", raising=False)
    monkeypatch.delenv("SNAGA_API_KEY", raising=False)
    with pytest.raises(ConfigError):
        Client()


def test_a_set_but_empty_env_var_is_still_a_missing_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("UARP_API_KEY", "")
    monkeypatch.delenv("SNAGA_API_KEY", raising=False)
    with pytest.raises(ConfigError):
        Client()


def test_the_key_and_base_url_come_from_the_environment(server: Server, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("UARP_API_KEY", "uarp_env_key")
    monkeypatch.setenv("UARP_BASE_URL", server.url)
    server.route = lambda request: Reply.json(EMPTY_PAGE)
    Client(max_retries=0).agents.list()
    assert server.received[0].headers["authorization"] == "Bearer uarp_env_key"


def test_an_empty_api_key_sends_no_authorization_header(server: Server) -> None:
    server.route = lambda request: Reply.json(EMPTY_PAGE)
    client_for(server, api_key="").agents.list()
    assert "authorization" not in server.received[0].headers


# ------------------------------------------------------------------- paging


def test_list_all_follows_the_cursor_past_an_empty_page(server: Server) -> None:
    pages = {
        "": {"items": [agent_json("a1")], "cursor": "c1", "has_more": True},
        "c1": {"items": [], "cursor": "c2", "has_more": True},
        "c2": {"items": [agent_json("a2")], "cursor": None, "has_more": False},
    }

    def route(request: Received) -> Reply:
        cursor = dict(part.split("=") for part in request.query.split("&") if part).get("cursor", "")
        return Reply.json(pages[cursor])

    server.route = route
    ids = [agent.agent_id for agent in client_for(server).agents.list_all(limit=1)]
    assert ids == ["a1", "a2"]
    assert [request.query for request in server.received] == ["limit=1", "limit=1&cursor=c1", "limit=1&cursor=c2"]


def test_list_all_stops_when_a_server_repeats_a_cursor(server: Server) -> None:
    server.route = lambda request: Reply.json({"items": [agent_json()], "cursor": "same", "has_more": True})
    #  Bounded, so the defect this guards against fails the test instead of hanging it.
    assert len(list(itertools.islice(client_for(server).agents.list_all(), 10))) == 2
    assert len(server.received) == 2


# ------------------------------------------------------------------ streams


def run_events(*chunks: Any) -> Reply:
    return Reply.events(*chunks)


def test_streams_server_sent_events(server: Server) -> None:
    server.route = lambda request: run_events(
        b'id: 1\nevent: llm.chunk\ndata: {"text":"he"}\n\n', b"event: run.completed\ndata: {}\n\n"
    )
    seen = []
    with client_for(server).runs.stream_run_events("r1") as events:
        for event in events:
            seen.append((event.id, event.event, event.data))
            if event.event == "run.completed":
                break
    assert seen == [("1", "llm.chunk", '{"text":"he"}'), (None, "run.completed", "{}")]
    (request,) = server.received
    assert request.headers["accept"] == "text/event-stream"
    assert "idempotency-key" not in request.headers


def test_a_header_parameter_reaches_the_wire(server: Server) -> None:
    server.route = lambda request: run_events(b"event: run.completed\ndata: {}\n\n")
    stream = client_for(server).runs.stream_run_events("r1", last_event_id="42")
    next(stream)
    stream.close()
    assert server.received[0].headers["last-event-id"] == "42"


def test_reopens_a_finished_stream_with_the_last_event_id(server: Server) -> None:
    def route(request: Received) -> Reply:
        if len(server.received) == 1:
            return run_events(b"id: 7\ndata: first\n\n")
        return run_events(b"id: 8\nevent: run.completed\ndata: second\n\n")

    server.route = route
    options = StreamOptions(base_retry=0.001, max_backoff=0.002, terminal_events=frozenset({"run.completed"}))
    events = list(client_for(server).runs.stream_run_events("r1", request_options=RequestOptions(stream=options)))
    assert [event.data for event in events] == ["first", "second"]
    first, second = server.received
    assert "last-event-id" not in first.headers
    assert second.headers["last-event-id"] == "7"


def test_a_terminal_event_completes_the_stream_without_reconnecting(server: Server) -> None:
    server.route = lambda request: run_events(b"event: run.completed\ndata: {}\n\n")
    options = StreamOptions(base_retry=0.001, terminal_events=frozenset({"run.completed"}))
    assert len(list(client_for(server).runs.stream_run_events("r1", request_options=RequestOptions(stream=options)))) == 1
    assert len(server.received) == 1


def test_a_done_frame_completes_the_stream_without_reconnecting(server: Server) -> None:
    server.route = lambda request: run_events(b"data: one\n\ndata: [DONE]\n\n")
    options = StreamOptions(base_retry=0.001)
    events = list(client_for(server).runs.stream_run_events("r1", request_options=RequestOptions(stream=options)))
    assert [event.data for event in events] == ["one"]
    assert len(server.received) == 1


def test_a_401_surfaces_without_retrying(server: Server) -> None:
    server.route = lambda request: Reply.json({"title": "Unauthorized", "status": 401}, 401)
    options = StreamOptions(base_retry=0.001)
    with pytest.raises(APIError) as caught:
        list(client_for(server).runs.stream_run_events("r1", request_options=RequestOptions(stream=options)))
    assert caught.value.status == 401
    assert len(server.received) == 1


def test_a_404_stream_surfaces_at_once(server: Server) -> None:
    #  A wrong run id used to reconnect five times and surface twenty seconds later.
    server.route = lambda request: Reply.json({"title": "Not Found", "status": 404}, 404)
    options = StreamOptions(base_retry=0.001, max_backoff=0.002)
    with pytest.raises(NotFoundError):
        list(client_for(server).runs.stream_run_events("nope", request_options=RequestOptions(stream=options)))
    assert len(server.received) == 1


def test_a_503_stream_reconnects(server: Server) -> None:
    def route(request: Received) -> Reply:
        if len(server.received) == 1:
            return Reply.json({"title": "Unavailable", "status": 503}, 503)
        return run_events(b"data: one\n\ndata: [DONE]\n\n")

    server.route = route
    options = StreamOptions(base_retry=0.001, max_backoff=0.002)
    events = list(client_for(server).runs.stream_run_events("r1", request_options=RequestOptions(stream=options)))
    assert [event.data for event in events] == ["one"]
    assert len(server.received) == 2


def test_a_token_in_the_query_is_minted_never_the_api_key(server: Server) -> None:
    def route(request: Received) -> Reply:
        if request.method == "POST":
            return Reply.json({"token": f"sse_{len(server.received)}", "expires_at": "2026-10-30T00:01:00Z"}, 201)
        if len(server.received) == 2:
            return run_events(b"id: 1\ndata: one\n\n")
        return run_events(b"data: two\n\ndata: [DONE]\n\n")

    server.route = route
    options = StreamOptions(base_retry=0.001, max_backoff=0.002)
    client = client_for(server, sse_token_in_query=True)
    events = list(client.runs.stream_run_events("r1", request_options=RequestOptions(stream=options)))
    assert [event.data for event in events] == ["one", "two"]
    mint, first, again, second = server.received
    assert (mint.method, mint.path) == ("POST", "/api/v1/auth/sse-tokens")
    assert first.query == "token=sse_1"
    #  A reconnect mints its own: the first token may have expired.
    assert (again.method, second.query) == ("POST", "token=sse_3")
    assert all("uarp_test1234_secret" not in request.query for request in server.received)


def test_on_state_reports_the_connection_lifecycle(server: Server) -> None:
    #  The first connection delivers and ends; the second delivers nothing,
    #  which spends the one reconnect the budget allows.
    server.route = lambda request: run_events(b"data: one\n\n" if len(server.received) == 1 else b": idle\n\n")
    states: List[Any] = []
    options = StreamOptions(
        base_retry=0.001, max_backoff=0.002, max_reconnects=1, on_state=lambda state, attempt: states.append((state, attempt))
    )
    list(client_for(server).runs.stream_run_events("r1", request_options=RequestOptions(stream=options)))
    assert states == [
        (StreamState.CONNECTING, 0),
        (StreamState.CONNECTED, 0),
        (StreamState.RECONNECTING, 1),
        (StreamState.CONNECTED, 0),
        (StreamState.DISCONNECTED, 0),
    ]
    assert len(server.received) == 2


def test_the_inactivity_watchdog_reconnects_a_silent_socket_with_the_last_event_id(server: Server) -> None:
    def route(request: Received) -> Reply:
        if len(server.received) == 1:
            return run_events(b"id: 3\ndata: before\n\n", 2.0, b"data: too late\n\n")
        return run_events(b"id: 4\nevent: done\ndata: after\n\n")

    server.route = route
    options = StreamOptions(
        inactivity_timeout=0.3, base_retry=0.001, max_backoff=0.002, terminal_events=frozenset({"done"})
    )
    events = list(client_for(server).runs.stream_run_events("r1", request_options=RequestOptions(stream=options)))
    assert [event.data for event in events] == ["before", "after"]
    assert server.received[1].headers["last-event-id"] == "3"


def test_a_keyless_client_puts_no_token_in_the_sse_query(server: Server) -> None:
    server.route = lambda request: run_events(b"event: run.completed\ndata: {}\n\n")
    stream = client_for(server, api_key="", sse_token_in_query=True).runs.stream_run_events("r1")
    next(stream)
    stream.close()
    assert server.received[0].query == ""
    assert "authorization" not in server.received[0].headers


# -------------------------------------------------------------- stream_post

COMPLETION = {"model": "m", "stream": True, "messages": [{"role": "user", "content": "hi"}]}


def test_stream_post_sends_one_post_and_stops_at_done(server: Server) -> None:
    server.route = lambda request: run_events(
        b'data: {"choices":[{"delta":{"content":"he"}}]}\n\n',
        b'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
        b"data: [DONE]\n\n",
        b"data: after the end\n\n",
    )
    text = "".join(
        event.json()["choices"][0]["delta"]["content"]
        for event in client_for(server).stream_post("/api/v1/llm/chat/completions", COMPLETION)
    )
    assert text == "hello"
    (request,) = server.received
    assert request.method == "POST"
    assert request.headers["accept"] == "text/event-stream"
    assert request.headers["content-type"] == "application/json"
    assert UUID.match(request.headers["idempotency-key"])
    assert request.json() == COMPLETION


def test_stream_post_surfaces_a_refusal_without_retrying(server: Server) -> None:
    server.route = lambda request: Reply(
        429,
        b'{"title":"Too Many Requests","status":429,"detail":"llm quota exhausted"}',
        (("Content-Type", "application/problem+json"), ("Retry-After", "0")),
    )
    with pytest.raises(RateLimitError) as caught:
        list(client_for(server, max_retries=3).stream_post("/api/v1/llm/chat/completions", COMPLETION))
    assert caught.value.problem.detail == "llm quota exhausted"
    assert len(server.received) == 1


def test_stream_post_does_not_reconnect_when_the_body_ends(server: Server) -> None:
    server.route = lambda request: run_events(b"data: one\n\n")
    events = list(client_for(server).stream_post("/api/v1/llm/chat/completions", COMPLETION))
    assert [event.data for event in events] == ["one"]
    assert len(server.received) == 1


def test_stream_post_refuses_a_plain_json_200(server: Server) -> None:
    server.route = lambda request: Reply.json({"choices": [{"message": {"content": "hello"}}]})
    with pytest.raises(APIError) as caught:
        list(client_for(server).stream_post("/api/v1/llm/chat/completions", COMPLETION))
    assert caught.value.status == 200
    assert "hello" in caught.value.problem.extensions["body"]


def test_stream_post_refuses_an_empty_200(server: Server) -> None:
    server.route = lambda request: Reply(200, b"")
    with pytest.raises(APIError) as caught:
        list(client_for(server).stream_post("/api/v1/llm/chat/completions", COMPLETION))
    assert caught.value.status == 200


def test_closing_a_stream_ends_it(server: Server) -> None:
    server.route = lambda request: run_events(b"data: one\n\n", 5.0, b"data: never\n\n")
    stream = client_for(server).runs.stream_run_events("r1")
    assert next(stream).data == "one"
    stream.close()
    with pytest.raises(StopIteration):
        next(stream)
