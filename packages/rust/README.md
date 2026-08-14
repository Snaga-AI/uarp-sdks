# uarp-sdk

Async Rust client for the **UARP — Universal Agent Runtime Platform** API.
Full coverage of all 557 endpoints, built on `reqwest`, `serde` and `tokio`.

```toml
[dependencies]
uarp-sdk = "0.2"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
futures-util = "0.3"   # only if you use streams
```

Rust 1.75+. TLS is `rustls` by default; `features = ["native-tls"]` switches.

## Quick start

```rust
use uarp_sdk::models::{AgentModelConfig, AgentModelConfigProvider, CreateAgentRequest};

#[tokio::main]
async fn main() -> Result<(), uarp_sdk::Error> {
    let client = uarp_sdk::Client::from_env()?;   // UARP_API_KEY, UARP_BASE_URL

    let agent = client
        .agents()
        .create(&CreateAgentRequest {
            name: "demo".into(),
            model: AgentModelConfig {
                provider: AgentModelConfigProvider::OpenaiCompat,
                model_ref: "gpt-4o-mini".into(),
                capabilities: Default::default(),
                ..Default::default()
            },
            ..Default::default()
        })
        .await?;

    println!("{} {}", agent.agent_id, agent.name);
    Ok(())
}
```

`Client` is cheap to clone — every clone shares one connection pool. Resource
groups are accessor methods: `client.agents()`, `client.runs()`,
`client.sessions()`, … 43 in all, each in `uarp_sdk::api`.

## Streaming

SSE endpoints return an `EventStream`, a `futures::Stream` that reconnects with
`Last-Event-ID`:

```rust
use futures_util::StreamExt;

let runs = client.runs();
let params = Default::default();
let mut events = std::pin::pin!(runs.stream_run_events(&run_id, &params));

while let Some(event) = events.next().await {
    let event = event?;
    if event.event == "llm.chunk" {
        print!("{}", event.json::<serde_json::Value>()?["text"]);
    }
    if event.event == "run.completed" { break; }   // dropping the stream closes it
}
```

## Pagination

```rust
use futures_util::StreamExt;

let agents = client.agents();
let params = uarp_sdk::api::ListAgentsParams { limit: Some(100), ..Default::default() };
let mut all = std::pin::pin!(agents.list_all(&params));

while let Some(agent) = all.next().await {
    println!("{}", agent?.name);
}
```

`list_all` follows the cursor until the server reports no further pages, and
stops if a server ever repeats a cursor.

## Errors

```rust
use uarp_sdk::{ApiErrorKind, Error};

match client.agents().get("missing").await {
    Ok(agent) => println!("{}", agent.name),
    Err(Error::Api(api)) => match api.kind() {
        ApiErrorKind::NotFound => println!("no such agent"),
        ApiErrorKind::UnprocessableEntity => println!("{:?}", api.problem.errors),
        ApiErrorKind::RateLimit => println!("retry after {:?}", api.retry_after_seconds()),
        _ => println!("{api}"),
    },
    Err(Error::Timeout) => println!("timed out"),
    Err(other) => println!("{other}"),
}
```

`ApiError` carries the status, the parsed problem document, the response
headers, and `correlation_id()` for support tickets.

## Configuration

```rust
let client = uarp_sdk::Client::builder()
    .api_key(key)
    .base_url("http://localhost:8080")
    .timeout(std::time::Duration::from_secs(30))
    .max_retries(3)
    .user_agent("my-app/1.2.3")
    .default_header("X-Tenant", "acme")?
    .http_client(my_reqwest_client)   // proxies, tracing, custom TLS
    .build()?;
```

### Per-call overrides

Rust has no default arguments, so rather than an options parameter on all 557
methods the overrides ride on a cheap clone of the client — the connection pool
is shared:

```rust
client.with_idempotency_key("order-4711").agents().create(&body).await?;
client.with_timeout(Duration::from_secs(5)).agents().get(id).await?;
client.with_max_retries(0).agents().get(id).await?;
client.with_header("X-Trace", trace_id).agents().list(&params).await?;

// Reconnection behaviour for an event stream:
let quiet = client.with_stream_options(StreamOptions { reconnect: false, ..Default::default() });
let mut events = std::pin::pin!(quiet.runs().stream_run_events(&run_id, &Default::default()));
```

`with_options(RequestOptions { .. })` sets several at once.

**Retries.** `408`, `409`, `429` and `5xx`, plus connection errors, retry with
full-jitter backoff (500 ms → 8 s) and honour `Retry-After`. Reads always
retry; writes only when they carry an idempotency key, which every mutating
`/api/v1/*` call sends automatically.

## Escape hatch

```rust
let value: serde_json::Value = client
    .raw(reqwest::Method::POST, "/api/v1/experimental/thing", Some(&payload))
    .await?;
```

## Notes

- Fields the spec marks `required` are plain values; everything else is
  `Option<T>`. Unknown response fields are ignored, except on models that
  declare `additionalProperties`, which keep them in `extra`.
- Enums are real enums with an `Other(String)` catch-all, so a value the server
  adds later round-trips unchanged. `as_str()`, `Display` and `From<&str>` are
  provided.
- The three `oneOf` bodies in the spec are exposed as `serde_json::Value`.
- Timestamps are `String` (ISO-8601); the crate does not pull in a date library.

## Development

```sh
cargo test --all-features
cargo clippy --all-targets
cargo run --example quickstart
```

Files under `src/generated/` come from `generator/` in the repository root;
edit the emitter, not the output.
