//! The HTTP client: configuration, auth, retries, idempotency, error mapping.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Method, RequestBuilder};
use serde::de::DeserializeOwned;
use serde::Serialize;
use url::Url;

use crate::error::{ApiError, Error, Problem, Result};
use crate::generated::meta::DEFAULT_BASE_URL;
use crate::sse::{EventStream, StreamOptions};
use crate::util::encode_query_component;

/// Placeholder for "this request has no query string".
pub const NO_QUERY: Option<&()> = None;
/// Placeholder for "this request has no body".
pub const NO_BODY: Option<&()> = None;

const RETRYABLE: [u16; 7] = [408, 409, 429, 500, 502, 503, 504];

/// Per-call overrides.
///
/// Rust has no default arguments, so rather than add an options parameter to
/// every generated method these are carried by a cheap clone of the client:
/// `client.with_idempotency_key("order-4711").agents().create(&body)`.
#[derive(Debug, Clone, Default)]
pub struct RequestOptions {
    /// Overrides the client timeout for calls made through this clone.
    pub timeout: Option<Duration>,
    /// Overrides the client retry budget.
    pub max_retries: Option<u32>,
    /// Reuse a specific key, e.g. to safely replay a create.
    pub idempotency_key: Option<String>,
    /// Headers added to every request.
    pub extra_headers: Vec<(String, String)>,
    /// Query parameters added to every request.
    pub extra_query: Vec<(String, String)>,
    /// Reconnection behaviour for event streams.
    pub stream: Option<StreamOptions>,
}

/// What a generated method hands to the transport.
#[derive(Debug)]
pub struct Request<'a, Q: ?Sized = (), B: ?Sized = ()> {
    pub method: Method,
    pub path: String,
    pub query: Option<&'a Q>,
    pub body: Option<&'a B>,
    pub headers: Vec<(&'static str, String)>,
    /// Adds an `Idempotency-Key`, which also makes the write safe to retry.
    pub idempotent: bool,
}

pub(crate) struct Inner {
    pub(crate) http: reqwest::Client,
    pub(crate) base_url: Url,
    pub(crate) api_key: String,
    pub(crate) max_retries: u32,
    pub(crate) timeout: Duration,
    pub(crate) user_agent: String,
    pub(crate) default_headers: HeaderMap,
    pub(crate) sse_token_in_query: bool,
}

/// Client for the UARP platform API.
///
/// Cloning is cheap: every clone shares one connection pool.
///
/// ```no_run
/// # async fn demo() -> Result<(), uarp_sdk::Error> {
/// let client = uarp_sdk::Client::from_env()?;
/// let page = client.agents().list(&Default::default()).await?;
/// # Ok(()) }
/// ```
#[derive(Clone)]
pub struct Client {
    pub(crate) inner: Arc<Inner>,
    /// Overrides for calls made through this clone; the connection pool in
    /// `inner` is shared with the client it came from.
    pub(crate) options: RequestOptions,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client")
            .field("base_url", &self.inner.base_url.as_str())
            .field("max_retries", &self.inner.max_retries)
            .field("timeout", &self.inner.timeout)
            .field("options", &self.options)
            .finish_non_exhaustive()
    }
}

impl Client {
    /// Build a client for the production endpoint with the given API key.
    pub fn new(api_key: impl Into<String>) -> Result<Self> {
        ClientBuilder::new().api_key(api_key).build()
    }

    /// Read the API key from `UARP_API_KEY` (or `SNAGA_API_KEY`) and the base
    /// URL from `UARP_BASE_URL`.
    pub fn from_env() -> Result<Self> {
        let api_key = std::env::var("UARP_API_KEY")
            .or_else(|_| std::env::var("SNAGA_API_KEY"))
            .map_err(|_| Error::Config("UARP_API_KEY is not set".into()))?;
        let mut builder = ClientBuilder::new().api_key(api_key);
        if let Ok(base) = std::env::var("UARP_BASE_URL") {
            builder = builder.base_url(base);
        }
        builder.build()
    }

    pub fn builder() -> ClientBuilder {
        ClientBuilder::new()
    }

    pub fn base_url(&self) -> &Url {
        &self.inner.base_url
    }

    // ------------------------------------------------------- per-call options

    /// A clone of this client that applies `options` to every call made
    /// through it. The connection pool is shared, so this is cheap.
    pub fn with_options(&self, options: RequestOptions) -> Client {
        Client {
            inner: self.inner.clone(),
            options,
        }
    }

    /// Reuse a specific idempotency key, e.g. to safely replay a create.
    pub fn with_idempotency_key(&self, key: impl Into<String>) -> Client {
        let mut options = self.options.clone();
        options.idempotency_key = Some(key.into());
        self.with_options(options)
    }

    pub fn with_timeout(&self, timeout: Duration) -> Client {
        let mut options = self.options.clone();
        options.timeout = Some(timeout);
        self.with_options(options)
    }

    pub fn with_max_retries(&self, retries: u32) -> Client {
        let mut options = self.options.clone();
        options.max_retries = Some(retries);
        self.with_options(options)
    }

    /// Add a header to every request made through the returned client.
    pub fn with_header(&self, name: impl Into<String>, value: impl Into<String>) -> Client {
        let mut options = self.options.clone();
        options.extra_headers.push((name.into(), value.into()));
        self.with_options(options)
    }

    /// Add a query parameter to every request made through the returned client.
    pub fn with_query(&self, name: impl Into<String>, value: impl Into<String>) -> Client {
        let mut options = self.options.clone();
        options.extra_query.push((name.into(), value.into()));
        self.with_options(options)
    }

    /// Reconnection behaviour for event streams opened through this clone.
    pub fn with_stream_options(&self, stream: StreamOptions) -> Client {
        let mut options = self.options.clone();
        options.stream = Some(stream);
        self.with_options(options)
    }

    // ------------------------------------------------------------ transport

    /// Send a request and decode a JSON response body.
    pub async fn request_json<Q, B, R>(&self, req: Request<'_, Q, B>) -> Result<R>
    where
        Q: Serialize + ?Sized + Sync,
        B: Serialize + ?Sized + Sync,
        R: DeserializeOwned,
    {
        let body = req.body;
        let response = self
            .run(&req, &move |builder: RequestBuilder| match body {
                Some(value) => Ok(builder.json(value)),
                None => Ok(builder),
            })
            .await?;
        decode_json(response).await
    }

    /// Send a request and discard the response body.
    pub async fn request_empty<Q, B>(&self, req: Request<'_, Q, B>) -> Result<()>
    where
        Q: Serialize + ?Sized + Sync,
        B: Serialize + ?Sized + Sync,
    {
        let body = req.body;
        self.run(&req, &move |builder: RequestBuilder| match body {
            Some(value) => Ok(builder.json(value)),
            None => Ok(builder),
        })
        .await?;
        Ok(())
    }

    /// Send a request and return the raw response bytes (file downloads).
    pub async fn request_bytes<Q, B>(&self, req: Request<'_, Q, B>) -> Result<Bytes>
    where
        Q: Serialize + ?Sized + Sync,
        B: Serialize + ?Sized + Sync,
    {
        let body = req.body;
        let response = self
            .run(&req, &move |builder: RequestBuilder| match body {
                Some(value) => Ok(builder.json(value)),
                None => Ok(builder),
            })
            .await?;
        response.bytes().await.map_err(Error::Connection)
    }

    /// Send a `multipart/form-data` request. The form is rebuilt for each retry.
    pub async fn request_multipart<Q, R, F>(
        &self,
        req: Request<'_, Q, ()>,
        make_form: F,
    ) -> Result<R>
    where
        Q: Serialize + ?Sized + Sync,
        R: DeserializeOwned,
        F: Fn() -> Result<reqwest::multipart::Form> + Send + Sync,
    {
        let response = self
            .run(&req, &move |builder: RequestBuilder| {
                Ok(builder.multipart(make_form()?))
            })
            .await?;
        decode_json(response).await
    }

    /// Open a server-sent event stream.
    pub fn request_stream<Q>(
        &self,
        path: &str,
        query: Option<&Q>,
        headers: Vec<(&'static str, String)>,
    ) -> EventStream
    where
        Q: Serialize + ?Sized,
    {
        let options = self.options.stream.clone().unwrap_or_default();
        let mut headers: Vec<(String, String)> = headers
            .into_iter()
            .map(|(name, value)| (name.to_string(), value))
            .collect();
        headers.extend(self.options.extra_headers.iter().cloned());
        let url = self.build_url(path, query).map(|mut url| {
            if self.inner.sse_token_in_query {
                url.query_pairs_mut()
                    .append_pair("token", &self.inner.api_key);
            }
            url
        });
        EventStream::new(self.inner.clone(), url, headers, options)
    }

    /// Escape hatch for endpoints the generated surface does not cover.
    pub async fn raw<R: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> Result<R> {
        let idempotent = method != Method::GET && path.starts_with("/api/v1");
        self.request_json(Request {
            method,
            path: path.to_string(),
            query: NO_QUERY,
            body,
            headers: Vec::new(),
            idempotent,
        })
        .await
    }

    // -------------------------------------------------------------- private

    async fn run<Q, B>(
        &self,
        req: &Request<'_, Q, B>,
        apply_body: &(dyn Fn(RequestBuilder) -> Result<RequestBuilder> + Send + Sync),
    ) -> Result<reqwest::Response>
    where
        Q: Serialize + ?Sized + Sync,
        B: Serialize + ?Sized + Sync,
    {
        let url = self.build_url(&req.path, req.query)?;
        let idempotency_key = req.idempotent.then(|| {
            self.options
                .idempotency_key
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
        });
        let retryable_method = req.method == Method::GET || req.method == Method::HEAD;
        let can_retry = retryable_method || idempotency_key.is_some();

        let retries = self.options.max_retries.unwrap_or(self.inner.max_retries);
        let timeout = self.options.timeout.unwrap_or(self.inner.timeout);

        let mut attempt: u32 = 0;
        loop {
            let mut builder = self
                .inner
                .http
                .request(req.method.clone(), url.clone())
                .timeout(timeout)
                .header(reqwest::header::ACCEPT, "application/json")
                .header(reqwest::header::USER_AGENT, &self.inner.user_agent)
                .header(
                    reqwest::header::AUTHORIZATION,
                    format!("Bearer {}", self.inner.api_key),
                )
                .headers(self.inner.default_headers.clone());

            for (name, value) in &req.headers {
                builder = builder.header(*name, value);
            }
            for (name, value) in &self.options.extra_headers {
                builder = builder.header(name.as_str(), value);
            }
            if let Some(key) = &idempotency_key {
                builder = builder.header("Idempotency-Key", key);
            }
            builder = apply_body(builder)?;

            match builder.send().await {
                Ok(response) if response.status().is_success() => return Ok(response),
                Ok(response) => {
                    let status = response.status().as_u16();
                    let headers = collect_headers(response.headers());
                    let retry_after = parse_retry_after(&headers);
                    let should_retry = RETRYABLE.contains(&status)
                        && headers.get("x-should-retry").map(String::as_str) != Some("false")
                        && can_retry
                        && attempt < retries;
                    if !should_retry {
                        let problem = read_problem(response).await;
                        return Err(ApiError {
                            status,
                            problem,
                            headers,
                        }
                        .into());
                    }
                    let wait = retry_after.unwrap_or_else(|| backoff(attempt));
                    attempt += 1;
                    tokio::time::sleep(wait.min(Duration::from_secs(60))).await;
                }
                Err(err) => {
                    let mapped = if err.is_timeout() {
                        Error::Timeout
                    } else {
                        Error::Connection(err)
                    };
                    if !can_retry || attempt >= retries {
                        return Err(mapped);
                    }
                    let wait = backoff(attempt);
                    attempt += 1;
                    tokio::time::sleep(wait).await;
                }
            }
        }
    }

    fn build_url<Q: Serialize + ?Sized>(&self, path: &str, query: Option<&Q>) -> Result<Url> {
        let mut url = self
            .inner
            .base_url
            .join(path.trim_start_matches('/'))
            .map_err(|err| Error::Config(format!("invalid path {path}: {err}")))?;
        if let Some(query) = query {
            //  serde_urlencoded turns the params struct into pairs, but writes
            //  them with form-encoding rules. Re-encode strictly so the five
            //  SDKs put the same bytes on the wire.
            let form =
                serde_urlencoded::to_string(query).map_err(|err| Error::Encode(err.to_string()))?;
            let encoded = form_urlencoded::parse(form.as_bytes())
                .map(|(name, value)| {
                    format!(
                        "{}={}",
                        encode_query_component(name.as_ref()),
                        encode_query_component(value.as_ref())
                    )
                })
                .collect::<Vec<_>>()
                .join("&");
            if !encoded.is_empty() {
                url.set_query(Some(&encoded));
            }
        }
        for (name, value) in &self.options.extra_query {
            let pair = format!(
                "{}={}",
                encode_query_component(name),
                encode_query_component(value)
            );
            let joined = match url.query() {
                Some(existing) if !existing.is_empty() => format!("{existing}&{pair}"),
                _ => pair,
            };
            url.set_query(Some(&joined));
        }
        Ok(url)
    }
}

/// Fluent configuration for [`Client`].
#[derive(Debug)]
pub struct ClientBuilder {
    api_key: Option<String>,
    base_url: String,
    timeout: Duration,
    max_retries: u32,
    user_agent: Option<String>,
    default_headers: HeaderMap,
    http: Option<reqwest::Client>,
    sse_token_in_query: bool,
}

impl Default for ClientBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl ClientBuilder {
    pub fn new() -> Self {
        Self {
            api_key: None,
            base_url: DEFAULT_BASE_URL.to_string(),
            timeout: Duration::from_secs(60),
            max_retries: 2,
            user_agent: None,
            default_headers: HeaderMap::new(),
            http: None,
            sse_token_in_query: false,
        }
    }

    pub fn api_key(mut self, api_key: impl Into<String>) -> Self {
        self.api_key = Some(api_key.into());
        self
    }

    pub fn base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    /// Per-request timeout. Default 60 s.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Retries for transient failures. Default 2.
    pub fn max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }

    /// Appended to the SDK's own User-Agent.
    pub fn user_agent(mut self, user_agent: impl Into<String>) -> Self {
        self.user_agent = Some(user_agent.into());
        self
    }

    pub fn default_header(mut self, name: &str, value: &str) -> Result<Self> {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|err| Error::Config(format!("invalid header name: {err}")))?;
        let value = HeaderValue::from_str(value)
            .map_err(|err| Error::Config(format!("invalid header value: {err}")))?;
        self.default_headers.insert(name, value);
        Ok(self)
    }

    /// Supply a preconfigured `reqwest::Client` (proxies, custom TLS, tracing).
    pub fn http_client(mut self, http: reqwest::Client) -> Self {
        self.http = Some(http);
        self
    }

    /// Send the API key as `?token=` on SSE requests instead of a header.
    pub fn sse_token_in_query(mut self, enabled: bool) -> Self {
        self.sse_token_in_query = enabled;
        self
    }

    pub fn build(self) -> Result<Client> {
        let api_key = self.api_key.ok_or_else(|| {
            Error::Config("missing API key: call .api_key(...) or Client::from_env()".into())
        })?;
        // A trailing slash makes `Url::join` keep the whole base path.
        let mut base = self.base_url.trim_end_matches('/').to_string();
        base.push('/');
        let base_url =
            Url::parse(&base).map_err(|err| Error::Config(format!("invalid base URL: {err}")))?;

        let sdk_agent = format!("uarp-sdk-rust/{}", env!("CARGO_PKG_VERSION"));
        let user_agent = match self.user_agent {
            Some(extra) => format!("{sdk_agent} {extra}"),
            None => sdk_agent,
        };

        let http = match self.http {
            Some(http) => http,
            None => reqwest::Client::builder()
                .build()
                .map_err(|err| Error::Config(format!("could not build HTTP client: {err}")))?,
        };

        Ok(Client {
            options: RequestOptions::default(),
            inner: Arc::new(Inner {
                http,
                base_url,
                api_key,
                max_retries: self.max_retries,
                timeout: self.timeout,
                user_agent,
                default_headers: self.default_headers,
                sse_token_in_query: self.sse_token_in_query,
            }),
        })
    }
}

// ------------------------------------------------------------------ helpers

async fn decode_json<R: DeserializeOwned>(response: reqwest::Response) -> Result<R> {
    let bytes = response.bytes().await.map_err(Error::Connection)?;
    // Endpoints documented without a response body still deserialize as `null`.
    let slice: &[u8] = if bytes.is_empty() { b"null" } else { &bytes };
    serde_json::from_slice(slice).map_err(Error::Decode)
}

async fn read_problem(response: reqwest::Response) -> Problem {
    match response.bytes().await {
        Ok(bytes) if !bytes.is_empty() => {
            serde_json::from_slice(&bytes).unwrap_or_else(|_| Problem {
                detail: Some(String::from_utf8_lossy(&bytes).into_owned()),
                ..Problem::default()
            })
        }
        _ => Problem::default(),
    }
}

pub(crate) fn collect_headers(headers: &HeaderMap) -> HashMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            Some((
                name.as_str().to_ascii_lowercase(),
                value.to_str().ok()?.to_string(),
            ))
        })
        .collect()
}

fn parse_retry_after(headers: &HashMap<String, String>) -> Option<Duration> {
    let raw = headers.get("retry-after")?;
    raw.parse::<f64>()
        .ok()
        .filter(|seconds| seconds.is_finite() && *seconds >= 0.0)
        .map(Duration::from_secs_f64)
}

/// Full-jitter exponential backoff capped at 8 s.
pub(crate) fn backoff(attempt: u32) -> Duration {
    let base = 500u64.saturating_mul(1u64 << attempt.min(4)).min(8_000);
    // No RNG dependency: the low bits of a v4 UUID are already random.
    let jitter = (uuid::Uuid::new_v4().as_u128() as u64) % (base / 2 + 1);
    Duration::from_millis(base / 2 + jitter)
}
