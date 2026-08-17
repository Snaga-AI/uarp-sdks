//! Integration tests for the transport, exercised through generated methods.

use std::pin::pin;

use futures_util::StreamExt;
use serde_json::json;
use uarp_sdk::api::{ListAgentsParams, StreamRunEventsParams};
use uarp_sdk::{ApiErrorKind, Client, Error, StreamOptions, StreamState};
use wiremock::matchers::{body_json, header, header_exists, method, path, query_param};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

/// A complete `Agent` payload — the model decodes strictly, so every field the
/// spec marks required has to be present.
fn agent_json(id: &str) -> serde_json::Value {
    json!({
        "agent_id": id,
        "tenant_id": "t1",
        "name": "demo",
        "model": {"provider": "openai_compat", "model_ref": "gpt-x", "capabilities": {}},
        "created_at": "2026-01-01T00:00:00Z"
    })
}

fn create_agent_request() -> uarp_sdk::models::CreateAgentRequest {
    //  The platform picks the model itself and ignores anything sent for it,
    //  so a create is just a name.
    uarp_sdk::models::CreateAgentRequest {
        name: "demo".into(),
        ..Default::default()
    }
}

async fn client_for(server: &MockServer) -> Client {
    Client::builder()
        .api_key("uarp_test1234_secret")
        .base_url(server.uri())
        .max_retries(0)
        .build()
        .expect("client builds")
}

#[tokio::test]
async fn sends_auth_and_user_agent() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents"))
        .and(header("authorization", "Bearer uarp_test1234_secret"))
        .and(header("accept", "application/json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [], "cursor": null, "has_more": false
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let page = client
        .agents()
        .list(&ListAgentsParams::default())
        .await
        .expect("request succeeds");
    assert!(page.items.is_empty());

    let recorded = &server.received_requests().await.unwrap()[0];
    let agent = recorded
        .headers
        .get("user-agent")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(
        agent.starts_with("uarp-sdk-rust/"),
        "unexpected user agent: {agent}"
    );
}

#[tokio::test]
async fn serialises_query_parameters_and_skips_none() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents"))
        .and(query_param("limit", "25"))
        .and(query_param("include_offline", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [], "cursor": null, "has_more": false
        })))
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let params = ListAgentsParams {
        limit: Some(25),
        include_offline: Some(true),
        ..Default::default()
    };
    client
        .agents()
        .list(&params)
        .await
        .expect("request succeeds");

    let recorded = &server.received_requests().await.unwrap()[0];
    assert!(
        !recorded.url.query().unwrap().contains("cursor"),
        "None parameters must be omitted"
    );
}

#[tokio::test]
async fn percent_encodes_path_parameters() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents/id%20with%2Fslash"))
        .respond_with(ResponseTemplate::new(200).set_body_json(agent_json("x")))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    client
        .agents()
        .get("id with/slash")
        .await
        .expect("request succeeds");
}

#[tokio::test]
async fn attaches_idempotency_key_to_writes_only() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/agents"))
        .and(header_exists("idempotency-key"))
        .respond_with(ResponseTemplate::new(201).set_body_json(agent_json("a1")))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [], "cursor": null, "has_more": false
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let body = create_agent_request();
    client
        .agents()
        .create(&body)
        .await
        .expect("create succeeds");
    client
        .agents()
        .list(&ListAgentsParams::default())
        .await
        .expect("list succeeds");

    let requests = server.received_requests().await.unwrap();
    let get = requests
        .iter()
        .find(|r| r.method == wiremock::http::Method::GET)
        .unwrap();
    assert!(
        get.headers.get("idempotency-key").is_none(),
        "reads must not carry an idempotency key"
    );
}

#[tokio::test]
async fn sends_json_body() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/agents"))
        .and(header("content-type", "application/json"))
        .and(body_json(
            serde_json::to_value(create_agent_request()).unwrap(),
        ))
        .respond_with(ResponseTemplate::new(201).set_body_json(agent_json("a1")))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let body = create_agent_request();
    let agent = client
        .agents()
        .create(&body)
        .await
        .expect("create succeeds");
    assert_eq!(agent.agent_id, "a1");
}

#[tokio::test]
async fn retries_429_and_honours_retry_after() {
    let server = MockServer::start().await;
    let responses = std::sync::Mutex::new(0u32);
    Mock::given(method("GET"))
        .and(path("/api/v1/agents/a1"))
        .respond_with(move |_: &Request| {
            let mut count = responses.lock().unwrap();
            *count += 1;
            if *count == 1 {
                ResponseTemplate::new(429)
                    .insert_header("retry-after", "0")
                    .set_body_json(json!({
                        "type": "about:blank", "title": "Too Many Requests", "status": 429
                    }))
            } else {
                ResponseTemplate::new(200).set_body_json(agent_json("a1"))
            }
        })
        .expect(2)
        .mount(&server)
        .await;

    let client = Client::builder()
        .api_key("k")
        .base_url(server.uri())
        .max_retries(2)
        .build()
        .unwrap();
    let agent = client.agents().get("a1").await.expect("retry succeeds");
    assert_eq!(agent.agent_id, "a1");
}

#[tokio::test]
async fn surfaces_rate_limit_hints_from_the_headers() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents/a1"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "1.5")
                .insert_header("x-ratelimit-remaining", "0")
                .insert_header("x-correlation-id", "corr-9")
                .set_body_json(json!({"title": "Too Many Requests", "status": 429})),
        )
        .mount(&server)
        .await;

    //  No retries, or the transport would swallow the 429 we want to inspect.
    let client = Client::builder()
        .api_key("k")
        .base_url(server.uri())
        .max_retries(0)
        .build()
        .unwrap();
    let error = client.agents().get("a1").await.expect_err("must fail");

    match error {
        Error::Api(api) => {
            assert_eq!(api.kind(), ApiErrorKind::RateLimit);
            assert_eq!(api.retry_after_seconds(), Some(1.5));
            assert_eq!(api.rate_limit_remaining(), Some(0));
            //  Falls back to the header when the body carries no correlationId.
            assert_eq!(api.correlation_id(), Some("corr-9"));
            assert!(api.is_retryable());
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[tokio::test]
async fn maps_404_to_a_typed_error_without_retrying() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents/missing"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({
            "type": "about:blank",
            "title": "Not Found",
            "status": 404,
            "detail": "no such agent",
            "correlationId": "corr-1"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = Client::builder()
        .api_key("k")
        .base_url(server.uri())
        .max_retries(3)
        .build()
        .unwrap();
    let error = client.agents().get("missing").await.expect_err("must fail");
    match error {
        Error::Api(api) => {
            assert_eq!(api.kind(), ApiErrorKind::NotFound);
            assert_eq!(api.correlation_id(), Some("corr-1"));
            assert!(api.to_string().contains("no such agent"), "{api}");
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[tokio::test]
async fn exposes_validation_errors() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/agents"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "type": "about:blank",
            "title": "Unprocessable Entity",
            "status": 422,
            "errors": [{"field": "name", "message": "required"}]
        })))
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let error = client
        .agents()
        .create(&create_agent_request())
        .await
        .expect_err("must fail");
    match error {
        Error::Api(api) => {
            assert_eq!(api.kind(), ApiErrorKind::UnprocessableEntity);
            assert_eq!(api.problem.errors.len(), 1);
            assert_eq!(api.problem.errors[0].field.as_deref(), Some("name"));
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[tokio::test]
async fn list_all_follows_the_cursor() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents"))
        .respond_with(|request: &Request| {
            let cursor = request
                .url
                .query_pairs()
                .find(|(key, _)| key == "cursor")
                .map(|(_, value)| value.into_owned());
            match cursor.as_deref() {
                None => ResponseTemplate::new(200).set_body_json(json!({
                    "items": [agent_json("a1")], "cursor": "next", "has_more": true
                })),
                Some("next") => ResponseTemplate::new(200).set_body_json(json!({
                    "items": [agent_json("a2")], "cursor": null, "has_more": false
                })),
                Some(other) => panic!("unexpected cursor {other}"),
            }
        })
        .expect(2)
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let agents = client.agents();
    let params = ListAgentsParams::default();
    let mut stream = pin!(agents.list_all(&params));

    let mut ids = Vec::new();
    while let Some(agent) = stream.next().await {
        ids.push(agent.expect("page loads").agent_id);
    }
    assert_eq!(ids, vec!["a1".to_string(), "a2".to_string()]);
}

#[tokio::test]
async fn list_all_stops_when_a_server_repeats_a_cursor() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents"))
        //  A server that never clears its cursor would page forever.
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [agent_json("a1")], "cursor": "same", "has_more": true
        })))
        .expect(2)
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let agents = client.agents();
    let params = ListAgentsParams::default();
    let mut stream = pin!(agents.list_all(&params));

    let mut count = 0;
    while let Some(agent) = stream.next().await {
        agent.expect("page loads");
        count += 1;
    }
    assert_eq!(count, 2, "the cursor guard must stop the walk");
}

#[tokio::test]
async fn streams_server_sent_events() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/runs/r1/events"))
        .and(header("accept", "text/event-stream"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_raw(
                    "id: 1\nevent: llm.chunk\ndata: {\"text\":\"he\"}\n\nevent: run.completed\ndata: {}\n\n",
                    "text/event-stream",
                ),
        )
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let runs = client.runs();
    let params = StreamRunEventsParams::default();
    let mut stream = pin!(runs.stream_run_events("r1", &params));

    let mut names = Vec::new();
    while let Some(event) = stream.next().await {
        let event = event.expect("event decodes");
        let completed = event.event == "run.completed";
        names.push(event.event);
        if completed {
            break;
        }
    }
    assert_eq!(
        names,
        vec!["llm.chunk".to_string(), "run.completed".to_string()]
    );
}

fn publish_response() -> serde_json::Value {
    json!({
        "scope": "@demo",
        "name": "bundle",
        "version": "1.0.0",
        "publisher_tenant_id": "t1",
        "manifest": {"name": "demo"},
        "sha256": "abc123",
        "size_bytes": 3,
        "visibility": "public",
        "published_at": "2026-01-01T00:00:00Z"
    })
}

#[tokio::test]
async fn builds_a_multipart_body() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/registry/publish"))
        .and(header_exists("idempotency-key"))
        .respond_with(ResponseTemplate::new(201).set_body_json(publish_response()))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let request = uarp_sdk::models::RegistryPublishRequest {
        manifest: "{\"name\":\"demo\"}".into(),
        artifact: uarp_sdk::FilePart::new("bundle.tar.zst", vec![0x00, 0xFF, 0x41])
            .content_type("application/zstd"),
        sha256: Some("abc123".into()),
        ..Default::default()
    };
    client
        .registry()
        .registry_publish(&request)
        .await
        .expect("publish succeeds");

    let recorded = &server.received_requests().await.unwrap()[0];
    let content_type = recorded
        .headers
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(
        content_type.starts_with("multipart/form-data; boundary="),
        "{content_type}"
    );

    let body = String::from_utf8_lossy(&recorded.body);
    assert!(body.contains("name=\"manifest\""), "{body}");
    assert!(
        body.contains("name=\"artifact\"; filename=\"bundle.tar.zst\""),
        "{body}"
    );
    assert!(body.contains("application/zstd"), "{body}");
    assert!(body.contains("name=\"sha256\""), "{body}");
    //  An optional part the caller left out must not appear at all.
    assert!(!body.contains("attestation"), "{body}");
    //  The raw bytes must survive, NUL and high byte included.
    assert!(
        recorded.body.windows(3).any(|w| w == [0x00, 0xFF, 0x41]),
        "file bytes were altered"
    );
}

#[tokio::test]
async fn downloads_bytes_verbatim() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/files/f1/content"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/octet-stream")
                .set_body_bytes(vec![0x00, 0xFF, 0x41, 0x00, 0x42]),
        )
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let bytes = client
        .files()
        .download_file_content("f1")
        .await
        .expect("download succeeds");
    assert_eq!(bytes.as_ref(), &[0x00, 0xFF, 0x41, 0x00, 0x42]);
}

#[tokio::test]
async fn honours_the_no_retry_hint() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents/a1"))
        .respond_with(
            ResponseTemplate::new(500)
                .insert_header("x-should-retry", "false")
                .insert_header("retry-after", "0")
                .set_body_json(json!({"title": "boom", "status": 500})),
        )
        //  A 500 is normally retried; the header has to win.
        .expect(1)
        .mount(&server)
        .await;

    let client = Client::builder()
        .api_key("k")
        .base_url(server.uri())
        .max_retries(3)
        .build()
        .unwrap();
    let error = client.agents().get("a1").await.expect_err("must fail");
    assert!(matches!(error, Error::Api(_)), "{error:?}");
}

#[tokio::test]
async fn can_carry_the_key_in_the_query_for_event_streams() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/runs/r1/events"))
        .and(query_param("token", "uarp_secret"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_raw("event: run.completed\ndata: {}\n\n", "text/event-stream"),
        )
        .expect(1)
        .mount(&server)
        .await;

    //  Browser proxies that strip Authorization need the key in the URL.
    let client = Client::builder()
        .api_key("uarp_secret")
        .base_url(server.uri())
        .sse_token_in_query(true)
        .build()
        .unwrap();
    let runs = client.runs();
    let params = StreamRunEventsParams::default();
    let mut stream = pin!(runs.stream_run_events("r1", &params));

    let first = stream.next().await.expect("one event").expect("decodes");
    assert_eq!(first.event, "run.completed");
}

#[tokio::test]
async fn reopens_a_finished_stream_with_the_last_event_id() {
    let server = MockServer::start().await;
    let seen = std::sync::Mutex::new(0u32);
    Mock::given(method("GET"))
        .and(path("/api/v1/runs/r1/events"))
        .respond_with(move |request: &Request| {
            let mut count = seen.lock().unwrap();
            *count += 1;
            let resumed = request
                .headers
                .get("last-event-id")
                .map(|value| value.to_str().unwrap().to_string());
            let frames = match resumed {
                None => "id: 7\nevent: first\ndata: {}\n\n".to_string(),
                Some(id) => format!("event: resumed.{id}\ndata: {{}}\n\n"),
            };
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_raw(frames, "text/event-stream")
        })
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let runs = client.runs();
    let params = StreamRunEventsParams::default();
    let mut stream = pin!(runs.stream_run_events("r1", &params));

    let mut names = Vec::new();
    while let Some(event) = stream.next().await {
        let event = event.expect("event decodes");
        let resumed = event.event.starts_with("resumed.");
        names.push(event.event);
        if resumed {
            break;
        }
    }

    //  The second connection has to replay the id the first one delivered.
    assert_eq!(names, vec!["first".to_string(), "resumed.7".to_string()]);
}

#[tokio::test]
async fn does_not_retry_a_write_that_carries_no_idempotency_key() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/experimental/thing"))
        .respond_with(
            ResponseTemplate::new(500)
                .insert_header("retry-after", "0")
                .set_body_json(json!({"title": "boom", "status": 500})),
        )
        //  Outside /api/v1 the transport adds no key, so replaying the write
        //  would risk performing it twice.
        .expect(1)
        .mount(&server)
        .await;

    let client = Client::builder()
        .api_key("k")
        .base_url(server.uri())
        .max_retries(3)
        .build()
        .unwrap();
    let error = client
        .raw::<serde_json::Value>(reqwest::Method::POST, "/experimental/thing", None)
        .await
        .expect_err("must fail");
    assert!(matches!(error, Error::Api(_)), "{error:?}");
}

#[tokio::test]
async fn reuses_a_caller_supplied_idempotency_key() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/agents"))
        .and(header("idempotency-key", "order-4711"))
        .respond_with(ResponseTemplate::new(201).set_body_json(agent_json("a1")))
        .expect(1)
        .mount(&server)
        .await;

    //  Per-call overrides ride on a clone of the client.
    let client = client_for(&server).await;
    client
        .with_idempotency_key("order-4711")
        .agents()
        .create(&create_agent_request())
        .await
        .expect("create succeeds");
}

#[tokio::test]
async fn per_call_overrides_travel_on_a_clone() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents/a1"))
        .and(header("x-trace", "abc"))
        .and(query_param("debug", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(agent_json("a1")))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents/a2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(agent_json("a2")))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let traced = client
        .with_header("X-Trace", "abc")
        .with_query("debug", "1");

    traced
        .agents()
        .get("a1")
        .await
        .expect("traced call succeeds");
    //  The original client keeps its own settings.
    client
        .agents()
        .get("a2")
        .await
        .expect("plain call succeeds");
}

#[tokio::test]
async fn a_clone_can_turn_retries_off() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents/a1"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "0")
                .set_body_json(json!({"title": "slow down", "status": 429})),
        )
        .expect(1)
        .mount(&server)
        .await;

    let client = Client::builder()
        .api_key("k")
        .base_url(server.uri())
        .max_retries(5)
        .build()
        .unwrap();
    client
        .with_max_retries(0)
        .agents()
        .get("a1")
        .await
        .expect_err("must fail without retrying");
}

#[tokio::test]
async fn decodes_an_enum_value_it_has_never_seen() {
    //  A value the API adds later must round-trip rather than fail.
    let decoded: uarp_sdk::models::GetMeResponseAuthMethod =
        serde_json::from_str("\"brand_new\"").expect("decodes");
    assert_eq!(decoded.as_str(), "brand_new");
    assert_eq!(serde_json::to_string(&decoded).unwrap(), "\"brand_new\"");
    assert_eq!(
        decoded,
        uarp_sdk::models::GetMeResponseAuthMethod::from("brand_new")
    );
}

#[tokio::test]
async fn from_env_reports_a_missing_key() {
    // `Client::new` requires an explicit key; the builder rejects an empty config.
    let error = Client::builder().build().expect_err("must fail");
    assert!(matches!(error, Error::Config(_)), "{error:?}");
}

// ------------------------------------------------------------ SSE reconnect

/// A stream client aimed at `server` with no unary retries and the given SSE
/// options, so the reconnect loop is the only retry surface under test.
fn stream_client(server: &MockServer, options: StreamOptions) -> Client {
    Client::builder()
        .api_key("uarp_test1234_secret")
        .base_url(server.uri())
        .max_retries(0)
        .build()
        .unwrap()
        .with_stream_options(options)
}

fn sse_response(body: &str) -> ResponseTemplate {
    ResponseTemplate::new(200)
        .insert_header("content-type", "text/event-stream")
        .set_body_raw(body.as_bytes().to_vec(), "text/event-stream")
}

#[tokio::test]
async fn a_terminal_event_completes_the_stream_without_reconnecting() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/runs/r1/events"))
        .and(header("accept", "text/event-stream"))
        .respond_with(sse_response(
            "id: 1\nevent: llm.chunk\ndata: {\"text\":\"he\"}\n\nevent: run.completed\ndata: {}\n\n",
        ))
        .expect(1)
        .mount(&server)
        .await;

    let client = stream_client(
        &server,
        StreamOptions {
            terminal_events: vec!["run.completed".into()],
            ..Default::default()
        },
    );
    let mut stream = pin!(client.runs().stream_run_events("r1", &StreamRunEventsParams::default()));

    let mut names = Vec::new();
    while let Some(event) = stream.next().await {
        names.push(event.expect("event decodes").event);
    }
    assert_eq!(
        names,
        vec!["llm.chunk".to_string(), "run.completed".to_string()]
    );
}

#[tokio::test]
async fn a_done_frame_completes_the_stream_without_reconnecting() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/runs/r1/events"))
        .and(header("accept", "text/event-stream"))
        .respond_with(sse_response(
            "data: {\"text\":\"hi\"}\n\ndata: [DONE]\n\n",
        ))
        .expect(1)
        .mount(&server)
        .await;

    let client = stream_client(&server, StreamOptions::default());
    let mut stream = pin!(client.runs().stream_run_events("r1", &StreamRunEventsParams::default()));

    let mut events = Vec::new();
    while let Some(event) = stream.next().await {
        events.push(event.expect("event decodes"));
    }
    assert_eq!(events.len(), 1, "[DONE] itself emits nothing");
    assert_eq!(events[0].data, "{\"text\":\"hi\"}");
}

#[tokio::test]
async fn a_401_surfaces_without_retrying() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/runs/r1/events"))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_json(json!({"title": "Unauthorized", "status": 401})),
        )
        .expect(1)
        .mount(&server)
        .await;

    let client = stream_client(&server, StreamOptions::default());
    let mut stream = pin!(client.runs().stream_run_events("r1", &StreamRunEventsParams::default()));

    let error = stream
        .next()
        .await
        .expect("one item")
        .expect_err("401 must surface");
    match error {
        Error::Api(api) => {
            assert_eq!(api.status, 401);
            assert_eq!(api.kind(), ApiErrorKind::Authentication);
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[tokio::test]
async fn on_state_reports_the_connection_lifecycle() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/runs/r1/events"))
        .respond_with(sse_response("event: run.completed\ndata: {}\n\n"))
        .expect(1)
        .mount(&server)
        .await;

    let states = std::sync::Arc::new(std::sync::Mutex::new(Vec::<StreamState>::new()));
    let captured = states.clone();
    let client = stream_client(
        &server,
        StreamOptions {
            terminal_events: vec!["run.completed".into()],
            on_state: Some(std::sync::Arc::new(move |state| {
                captured.lock().unwrap().push(state);
            })),
            ..Default::default()
        },
    );

    let mut stream = pin!(client.runs().stream_run_events("r1", &StreamRunEventsParams::default()));
    while let Some(event) = stream.next().await {
        let event = event.expect("event decodes");
        if event.event == "run.completed" {
            // the stream ends itself on the terminal; just drain the rest
        }
    }

    let observed = states.lock().unwrap().clone();
    assert_eq!(
        observed,
        vec![
            StreamState::Connecting,
            StreamState::Connected,
            StreamState::Disconnected
        ]
    );
}

#[tokio::test]
async fn inactivity_watchdog_reconnects_a_silent_socket_with_last_event_id() {
    // wiremock serves a complete body and closes, so it cannot model a socket
    // that goes silent mid-stream. A raw TCP server does: the first connection
    // sends one frame then holds the socket open with no FIN (a silently-dead
    // proxy); the second sends a terminal and closes. The watchdog must fire on
    // the silence and reconnect carrying `Last-Event-ID: 1`.
    use std::io::{Read, Write};
    use std::time::Duration;

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let first = "id: 1\nevent: llm.chunk\ndata: {\"text\":\"he\"}\n\n";
    let second = "event: run.completed\ndata: {}\n\n";

    std::thread::spawn(move || {
        for attempt in 1..=2u32 {
            let (mut conn, _) = match listener.accept() {
                Ok(pair) => pair,
                Err(_) => break,
            };
            let frame = if attempt == 1 { first } else { second };
            let hold = attempt == 1;
            std::thread::spawn(move || {
                // Best-effort drain of the request line + headers.
                let mut buf = [0u8; 4096];
                let _ = conn.read(&mut buf);
                let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n";
                let _ = conn.write_all(head.as_bytes());
                let _ = conn.write_all(frame.as_bytes());
                let _ = conn.flush();
                if hold {
                    // Hold the socket open without sending more and without
                    // closing — a silent-but-not-dead connection. Drop after a
                    // generous delay so the thread doesn't outlive the test.
                    std::thread::sleep(Duration::from_secs(10));
                }
                // drop conn → the terminal connection sends an EOF.
            });
        }
    });

    let client = Client::builder()
        .api_key("uarp_test1234_secret")
        .base_url(format!("http://127.0.0.1:{port}"))
        .max_retries(0)
        .build()
        .unwrap()
        .with_stream_options(StreamOptions {
            terminal_events: vec!["run.completed".into()],
            inactivity_timeout: Some(Duration::from_millis(150)),
            base_retry: Duration::from_millis(1),
            max_backoff: Duration::from_millis(2),
            ..Default::default()
        });
    let mut stream = pin!(client.runs().stream_run_events("r1", &StreamRunEventsParams::default()));

    let mut names = Vec::new();
    while let Some(event) = stream.next().await {
        names.push(event.expect("event decodes").event);
    }
    assert_eq!(
        names,
        vec!["llm.chunk".to_string(), "run.completed".to_string()],
        "the silent socket must reconnect and deliver the terminal"
    );
}

/// A client whose credentials travel another way.
///
/// `Bearer ` with nothing after it is NOT the same as sending no header: a
/// server that validates the value can refuse it. TypeScript and Swift already
/// draw this line; these pin it for Rust so the family stays consistent.
///
/// Omitted still fails at `build()` — "forgot to set the key" is the common
/// mistake and a 401 is a much worse way to learn about it.
#[tokio::test]
async fn an_empty_api_key_sends_no_authorization_header() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents"))
        .and(wiremock::matchers::header_regex("authorization", ".*"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"items": [], "cursor": null, "has_more": false})))
        .expect(1)
        .mount(&server)
        .await;

    let client = Client::builder()
        .api_key("")
        .base_url(server.uri())
        .build()
        .expect("an explicitly empty key is a statement, not a mistake");
    let params = ListAgentsParams::default();
    client.agents().list(&params).await.expect("request succeeds");
}

#[tokio::test]
async fn a_real_api_key_is_still_sent() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/agents"))
        .and(header("authorization", "Bearer uarp_secret"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"items": [], "cursor": null, "has_more": false})))
        .expect(1)
        .mount(&server)
        .await;

    let client = Client::builder()
        .api_key("uarp_secret")
        .base_url(server.uri())
        .build()
        .unwrap();
    let params = ListAgentsParams::default();
    client.agents().list(&params).await.expect("request succeeds");
}

#[tokio::test]
async fn a_keyless_client_puts_no_token_in_the_sse_query() {
    let server = MockServer::start().await;
    //  `?token=` empty is a credential the server then rejects, so a keyless
    //  client must omit the parameter entirely.
    Mock::given(method("GET"))
        .and(path("/api/v1/runs/r1/events"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_raw("event: run.completed\ndata: {}\n\n", "text/event-stream"),
        )
        .expect(1)
        .mount(&server)
        .await;

    let client = Client::builder()
        .api_key("")
        .base_url(server.uri())
        .sse_token_in_query(true)
        .build()
        .unwrap();
    let runs = client.runs();
    let params = StreamRunEventsParams::default();
    let mut stream = pin!(runs.stream_run_events("r1", &params));
    let first = stream.next().await.expect("one event").expect("decodes");
    assert_eq!(first.event, "run.completed");

    //  Assert on the request the server actually received, rather than on a
    //  matcher having matched — an empty `token=` would still satisfy a
    //  "has the parameter" style check.
    let requests = server.received_requests().await.expect("requests recorded");
    let sse = requests
        .iter()
        .find(|r| r.url.path() == "/api/v1/runs/r1/events")
        .expect("the stream request reached the server");
    assert!(
        sse.url.query_pairs().all(|(name, _)| name != "token"),
        "a keyless client must omit ?token= entirely, got {:?}",
        sse.url.query()
    );
}

#[test]
fn a_set_but_empty_env_var_is_still_a_missing_key() {
    //  Going keyless is a deliberate act on the builder. An empty env var is
    //  the environment's version of forgetting to set it.
    let previous = std::env::var("UARP_API_KEY").ok();
    let previous_snaga = std::env::var("SNAGA_API_KEY").ok();
    std::env::set_var("UARP_API_KEY", "");
    std::env::remove_var("SNAGA_API_KEY");

    let result = Client::from_env();
    assert!(
        matches!(result, Err(Error::Config(_))),
        "an empty UARP_API_KEY must be refused, not silently keyless"
    );

    match previous {
        Some(value) => std::env::set_var("UARP_API_KEY", value),
        None => std::env::remove_var("UARP_API_KEY"),
    }
    if let Some(value) = previous_snaga {
        std::env::set_var("SNAGA_API_KEY", value);
    }
}
