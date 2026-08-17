//! Server-sent events: incremental frame parsing plus a reconnecting [`Stream`].

use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use futures_core::Stream;
use futures_util::StreamExt;
use serde::de::DeserializeOwned;

use crate::client::{collect_headers, Inner};
use crate::error::{ApiError, Error, Problem, Result};

/// One decoded `text/event-stream` frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    /// `id:` field (or the `event_id` carried inside a JSON payload), replayed
    /// as `Last-Event-ID` when the stream reconnects.
    pub id: Option<String>,
    /// `event:` field; defaults to `message` or, when absent, to the `type`
    /// field inside a JSON data payload.
    pub event: String,
    /// Concatenated `data:` lines, without the trailing newline.
    pub data: String,
    /// `retry:` field in milliseconds.
    pub retry: Option<u64>,
}

impl Event {
    /// Deserialize `data` as JSON.
    pub fn json<T: DeserializeOwned>(&self) -> Result<T> {
        serde_json::from_str(&self.data).map_err(Error::Decode)
    }
}

/// Connection-lifecycle states reported by [`EventStream`] via
/// [`StreamOptions::on_state`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamState {
    /// About to open (or reopen) the HTTP connection. Fired once, before the
    /// first attempt.
    Connecting,
    /// The server answered 2xx and the stream is being read.
    Connected,
    /// Waiting on backoff before a reconnect attempt. `attempt` is 1-based.
    Reconnecting(u32),
    /// The stream ended without the caller dropping it (terminal frame,
    /// `[DONE]`, or the reconnect budget exhausted). NOT fired on caller drop.
    Disconnected,
}

/// Reconnection and lifecycle behaviour for [`EventStream`]. Every field
/// defaults to a generic, spec-compliant SSE stream; the platform-specific
/// knobs (terminal events, an inactivity watchdog, `retry:` pacing) are opt-in
/// so a caller that passes [`Default::default`] gets standard SSE.
pub struct StreamOptions {
    /// Reconnect (replaying `Last-Event-ID`) when the stream ends. Default `true`.
    pub reconnect: bool,
    /// Reconnect attempts without progress before giving up. Default `5`.
    pub max_reconnects: u32,
    /// Event names that complete the stream WITHOUT reconnecting. Empty by
    /// default: a generic stream reconnects on end and lets the caller stop it.
    pub terminal_events: Vec<String>,
    /// Max silence between reads before the socket is presumed dead and a
    /// reconnect is attempted. `None` disables the watchdog (EOF owns
    /// liveness). Mirrors the platform's 300 s inactivity timeout: collapsing
    /// it with EOF made a silently-dead socket look like a finished stream.
    pub inactivity_timeout: Option<Duration>,
    /// Base reconnect interval; a `retry:` field overrides it per stream.
    pub base_retry: Duration,
    /// Cap on the reconnect backoff.
    pub max_backoff: Duration,
    /// Reconnect budget resets after this long connected without a disconnect,
    /// so a long healthy stream doesn't carry "this is the Nth retry" baggage.
    pub stability_reset: Duration,
    /// Optional connection-lifecycle observer. `Disconnected` is NOT fired when
    /// the caller drops the stream — only on a natural end. Held in an `Arc` so
    /// [`StreamOptions`] stays [`Clone`] (it lives inside the cloneable
    /// [`crate::RequestOptions`]); share state through the closure's captures.
    pub on_state: Option<Arc<dyn Fn(StreamState) + Send + Sync>>,
}

impl Default for StreamOptions {
    fn default() -> Self {
        Self {
            reconnect: true,
            max_reconnects: 5,
            terminal_events: Vec::new(),
            inactivity_timeout: None,
            base_retry: Duration::from_millis(2_000),
            max_backoff: Duration::from_millis(8_000),
            stability_reset: Duration::from_millis(60_000),
            on_state: None,
        }
    }
}

impl Clone for StreamOptions {
    fn clone(&self) -> Self {
        Self {
            reconnect: self.reconnect,
            max_reconnects: self.max_reconnects,
            terminal_events: self.terminal_events.clone(),
            inactivity_timeout: self.inactivity_timeout,
            base_retry: self.base_retry,
            max_backoff: self.max_backoff,
            stability_reset: self.stability_reset,
            on_state: self.on_state.clone(),
        }
    }
}

impl std::fmt::Debug for StreamOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamOptions")
            .field("reconnect", &self.reconnect)
            .field("max_reconnects", &self.max_reconnects)
            .field("terminal_events", &self.terminal_events)
            .field("inactivity_timeout", &self.inactivity_timeout)
            .field("base_retry", &self.base_retry)
            .field("max_backoff", &self.max_backoff)
            .field("stability_reset", &self.stability_reset)
            .field("on_state", &self.on_state.as_ref().map(|_| "<stream state observer>"))
            .finish()
    }
}

/// A live SSE stream.
///
/// ```no_run
/// # use futures_util::StreamExt;
/// # async fn demo(client: uarp_sdk::Client) -> Result<(), uarp_sdk::Error> {
/// let mut stream = client.runs().stream_run_events("run-id", &Default::default());
/// while let Some(event) = stream.next().await {
///     let event = event?;
///     if event.event == "run.completed" { break; }
/// }
/// # Ok(()) }
/// ```
///
/// Dropping the stream closes the connection.
pub struct EventStream {
    inner: Pin<Box<dyn Stream<Item = Result<Event>> + Send>>,
}

impl std::fmt::Debug for EventStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EventStream").finish_non_exhaustive()
    }
}

impl EventStream {
    pub(crate) fn new(
        client: Arc<Inner>,
        url: Result<url::Url>,
        headers: Vec<(String, String)>,
        options: StreamOptions,
    ) -> Self {
        let on_state = options.on_state.clone();
        let stream = async_stream::try_stream! {
            let url = url?;
            let mut last_event_id: Option<String> = None;
            let mut attempt: u32 = 0;
            let mut base_retry = options.base_retry;

            if let Some(cb) = &on_state {
                cb(StreamState::Connecting);
            }

            'reconnect: loop {
                // A non-first attempt waits on backoff (and reports it) before
                // reopening the connection, so `Reconnecting` precedes the
                // sleep rather than racing it.
                if attempt > 0 {
                    if let Some(cb) = &on_state {
                        cb(StreamState::Reconnecting(attempt));
                    }
                    tokio::time::sleep(stream_backoff(attempt, base_retry, options.max_backoff)).await;
                }

                let mut builder = client
                    .http
                    .request(reqwest::Method::GET, url.clone())
                    .header(reqwest::header::ACCEPT, "text/event-stream")
                    .header(reqwest::header::USER_AGENT, &client.user_agent)
                    .headers(client.default_headers.clone());
                // Same rule as the unary path: an empty key means "no
                // credentials", and `Bearer ` with nothing after it is a
                // credential a validating server can refuse.
                if !client.api_key.is_empty() {
                    builder = builder.header(
                        reqwest::header::AUTHORIZATION,
                        format!("Bearer {}", client.api_key),
                    );
                }
                // On reconnect, replace any spec-supplied `Last-Event-ID` with
                // the id the last delivered event carried. On the FIRST attempt
                // (no event delivered yet) the caller-supplied id stays — a
                // public replay route keys off it.
                let resumed = &last_event_id;
                for (name, value) in &headers {
                    if resumed.is_some() && name.eq_ignore_ascii_case("Last-Event-ID") {
                        continue;
                    }
                    builder = builder.header(name.as_str(), value);
                }
                if let Some(id) = resumed {
                    builder = builder.header("Last-Event-ID", id);
                }

                let response = match builder.send().await {
                    Ok(response) => response,
                    Err(err) => {
                        // 401 never comes back as a send error; transport errors
                        // retry like a dropped connection while the budget lasts.
                        if !options.reconnect || attempt >= options.max_reconnects {
                            Err(if err.is_timeout() { Error::Timeout } else { Error::Connection(err) })?;
                        }
                        attempt += 1;
                        continue 'reconnect;
                    }
                };

                if !response.status().is_success() {
                    let status = response.status().as_u16();
                    // 401 always surfaces so the caller can act on it (the app
                    // treats it as "stop the stream"); any other HTTP error
                    // retries like a dropped connection while the budget lasts,
                    // then surfaces.
                    if status == 401 || !options.reconnect || attempt >= options.max_reconnects {
                        let response_headers = collect_headers(response.headers());
                        let problem = response
                            .bytes()
                            .await
                            .ok()
                            .and_then(|bytes| serde_json::from_slice::<Problem>(&bytes).ok())
                            .unwrap_or_default();
                        Err(Error::from(ApiError { status, problem, headers: response_headers }))?;
                    }
                    attempt += 1;
                    continue 'reconnect;
                }

                if let Some(cb) = &on_state {
                    cb(StreamState::Connected);
                }

                // A connection that delivered at least one event counts as
                // progress and resets the reconnect budget; one that closed
                // immediately does not, so a flapping server cannot spin here.
                let mut delivered = false;
                let mut terminal = false;
                let mut parser = Parser::default();
                let mut body = response.bytes_stream();
                let connected_at = Instant::now();

                'read: loop {
                    // Per-read inactivity watchdog: a socket that goes silent
                    // but stays open is NOT a finished stream — release the
                    // read and reconnect with `Last-Event-ID` rather than
                    // treating the silence as EOF. `tokio::time::timeout`
                    // resolves (does not reject), so the caller's task is
                    // untouched.
                    let next = if let Some(timeout) = options.inactivity_timeout {
                        match tokio::time::timeout(timeout, body.next()).await {
                            Ok(inner) => inner,
                            Err(_elapsed) => {
                                if !options.reconnect || attempt >= options.max_reconnects {
                                    break 'read;
                                }
                                attempt += 1;
                                continue 'reconnect;
                            }
                        }
                    } else {
                        body.next().await
                    };

                    let chunk = match next {
                        None => break 'read, // clean EOF — reconnect below
                        Some(Err(_err)) => {
                            // A mid-stream transport error is a dropped
                            // connection, not a finished stream: reconnect
                            // while the budget lasts (the error itself is not
                            // surfaced unless the budget is exhausted).
                            if !options.reconnect || attempt >= options.max_reconnects {
                                break 'read;
                            }
                            attempt += 1;
                            continue 'reconnect;
                        }
                        Some(Ok(chunk)) => chunk,
                    };

                    // A healthy connection that survived the stability window
                    // shouldn't carry "this is the Nth retry" baggage into its
                    // next disconnect.
                    if attempt > 0 && connected_at.elapsed() >= options.stability_reset {
                        attempt = 0;
                    }

                    let mut hit_terminal = false;
                    for event in parser.push(&chunk) {
                        if event.id.is_some() {
                            last_event_id.clone_from(&event.id);
                        }
                        if let Some(retry) = event.retry.filter(|&retry| retry > 0) {
                            base_retry = Duration::from_millis(retry);
                        }
                        delivered = true;
                        let is_terminal_event = options.terminal_events.iter().any(|name| name == &event.event);
                        yield event;
                        if is_terminal_event {
                            hit_terminal = true;
                            break;
                        }
                    }
                    // `data: [DONE]` may flush a pending event (returned in the
                    // `push` above) and then sets `is_done` — a hard terminal,
                    // no reconnect.
                    if hit_terminal || parser.is_done() {
                        terminal = true;
                        break 'read;
                    }
                }

                // Flush a frame left unterminated when the connection closed.
                // After `[DONE]` or a terminal event the parser state is already
                // reset, so this returns `None`; otherwise a trailing partial
                // frame is delivered.
                if !terminal {
                    if let Some(event) = parser.finish() {
                        if event.id.is_some() {
                            last_event_id.clone_from(&event.id);
                        }
                        let is_terminal_event = options.terminal_events.iter().any(|name| name == &event.event);
                        delivered = true;
                        yield event;
                        if is_terminal_event || parser.is_done() {
                            terminal = true;
                        }
                    }
                }

                if terminal {
                    if let Some(cb) = &on_state {
                        cb(StreamState::Disconnected);
                    }
                    break 'reconnect;
                }

                // A clean EOF without a terminal frame is a proxy/socket drop
                // mid-run, not a finished stream — reconnect with `Last-Event-ID`.
                if delivered {
                    attempt = 0;
                }
                if !options.reconnect || attempt >= options.max_reconnects {
                    if let Some(cb) = &on_state {
                        cb(StreamState::Disconnected);
                    }
                    break 'reconnect;
                }
                attempt += 1;
            }
        };
        Self {
            inner: Box::pin(stream),
        }
    }
}

impl Stream for EventStream {
    type Item = Result<Event>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.inner.as_mut().poll_next(cx)
    }
}

/// Half-deterministic, half-random backoff for SSE reconnects:
/// `max_sleep/2 + rand(0..max_sleep/2)`, so it climbs with attempts but clients
/// don't all wake on the same boundary. Mirrors the Kotlin `streamBackoff`;
/// separate from the unary-retry [`crate::client::backoff`].
fn stream_backoff(attempt: u32, base: Duration, max: Duration) -> Duration {
    let base_ms = base.as_millis() as u64;
    let max_ms = max.as_millis() as u64;
    let shift = attempt.saturating_sub(1).min(31);
    let exponential = base_ms.saturating_mul(1u64 << shift);
    let max_sleep = max_ms.min(exponential);
    let half = (max_sleep / 2).max(1);
    // No RNG dependency: the low bits of a v4 UUID are already random, matching
    // the unary-retry backoff's jitter source.
    let jitter = (uuid::Uuid::new_v4().as_u128() as u64) % (half + 1);
    Duration::from_millis(half + jitter)
}

/// Incremental `text/event-stream` decoder.
///
/// Handles the three wire shapes the platform emits — standard
/// `text/event-stream` frames (`event:`/`id:`/`data:`/`retry:`, blank-line
/// dispatch), a JSON object carried in an SSE comment
/// (`:{"type":"…","event_id":"…"}`), and a bare NDJSON line
/// (`{"type":"…","event_id":"…"}`) — plus the `data: [DONE]` hard terminal.
/// A frame with no `data:` is not a deliverable event (an `id:`/`retry:`-only
/// frame updates state only); `id` is per-frame, reset on dispatch.
///
/// Buffers bytes rather than text so multi-byte characters split across chunk
/// boundaries survive.
#[derive(Default)]
pub(crate) struct Parser {
    buffer: Vec<u8>,
    data: Vec<String>,
    event: String,
    id: Option<String>,
    retry: Option<u64>,
    has_fields: bool,
    done: bool,
}

impl Parser {
    /// `true` once a `data: [DONE]` frame arrived — the stream terminates
    /// without reconnecting.
    pub(crate) fn is_done(&self) -> bool {
        self.done
    }

    pub(crate) fn push(&mut self, chunk: &[u8]) -> Vec<Event> {
        self.buffer.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some(index) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = self.buffer.drain(..=index).collect::<Vec<u8>>();
            line.pop(); // '\n'
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if let Some(event) = self.feed(&String::from_utf8_lossy(&line)) {
                events.push(event);
            }
            if self.done {
                // `[DONE]` is a hard terminal: stop decoding so a trailing
                // keep-alive or partial line after it cannot emit.
                self.buffer.clear();
                break;
            }
        }
        events
    }

    /// Flush a frame left unterminated when the connection closed.
    pub(crate) fn finish(&mut self) -> Option<Event> {
        if self.done {
            return None;
        }
        if !self.buffer.is_empty() {
            let line = std::mem::take(&mut self.buffer);
            self.feed(&String::from_utf8_lossy(&line));
        }
        self.dispatch()
    }

    fn feed(&mut self, line: &str) -> Option<Event> {
        if line.is_empty() {
            return self.dispatch();
        }

        // SSE comment. The platform also carries a JSON payload in a comment
        // (`:{"type":"…","event_id":"…"}`); that is a self-contained frame.
        // A bare comment is a keep-alive.
        if let Some(rest) = line.strip_prefix(':') {
            let body = rest.trim();
            if body.starts_with('{') {
                return Some(self.inline_event(body));
            }
            return None;
        }

        // Bare NDJSON line — a self-contained frame with no field prefix.
        if line.starts_with('{') {
            return Some(self.inline_event(line));
        }

        let (field, value) = match line.find(':') {
            Some(index) => (
                &line[..index],
                line[index + 1..]
                    .strip_prefix(' ')
                    .unwrap_or(&line[index + 1..]),
            ),
            None => (line, ""),
        };
        self.has_fields = true;
        match field {
            "event" => self.event = value.to_string(),
            "data" => {
                if value == "[DONE]" {
                    self.done = true;
                    // Flush a pending event, if any; `[DONE]` itself carries no
                    // payload (and `dispatch` emits nothing when there is no
                    // `data:`).
                    return if !self.data.is_empty() || !self.event.is_empty() || self.id.is_some() {
                        self.dispatch()
                    } else {
                        None
                    };
                }
                self.data.push(value.to_string());
            }
            "id" => {
                if !value.contains('\0') {
                    self.id = Some(value.to_string());
                }
            }
            "retry" => self.retry = value.parse().ok(),
            _ => {} // unknown fields are ignored
        }
        None
    }

    fn dispatch(&mut self) -> Option<Event> {
        if !self.has_fields {
            return None;
        }
        let joined = self.data.join("\n");
        // A frame with no `data:` is not a deliverable event: an `id:`/`retry:`-
        // only frame updates state but carries nothing to emit.
        if joined.is_empty() {
            self.reset();
            return None;
        }
        let resolved = if !self.event.is_empty() {
            std::mem::take(&mut self.event)
        } else {
            extract_event_type(&joined).unwrap_or_else(|| "message".to_string())
        };
        let event = Event {
            id: self.id.clone(),
            event: resolved,
            data: joined,
            retry: self.retry.take(),
        };
        self.reset();
        Some(event)
    }

    /// A comment-JSON or NDJSON frame: type and id live inside the JSON body.
    /// Self-contained — does not mutate parser state.
    fn inline_event(&self, body: &str) -> Event {
        Event {
            id: extract_field(body, "event_id"),
            event: extract_event_type(body).unwrap_or_else(|| "message".to_string()),
            data: body.to_string(),
            retry: None,
        }
    }

    fn reset(&mut self) {
        self.data.clear();
        self.event.clear();
        self.id = None;
        self.retry = None;
        self.has_fields = false;
        // `id` is per-frame: the platform's client resets it on dispatch, so an
        // event's id is only the `id:` its own frame carried (or the `event_id`
        // inside a JSON payload). The loop captures the emitted id for replay
        // before this runs, so reconnect still resumes from the last event id.
    }
}

/// Pull one string field out of a JSON body WITHOUT fully decoding it — the
/// stream carries thousands of frames a minute, and a full parse per frame to
/// learn its `type` is the difference between a smooth stream and a stuttering
/// one. Honours escaped quotes so a `"` inside a value can't fool it.
fn extract_field(json: &str, field: &str) -> Option<String> {
    let mut needle = String::from("\"");
    needle.push_str(field);
    needle.push('"');
    let start = json.find(&needle)?;
    let bytes = json.as_bytes();
    let mut i = start + needle.len();
    while i < bytes.len() && (bytes[i] == b':' || bytes[i] == b' ') {
        i += 1;
    }
    if i >= bytes.len() || bytes[i] != b'"' {
        return None;
    }
    i += 1;
    let value_start = i;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => {
                i += 2;
                continue;
            }
            b'"' => break,
            _ => i += 1,
        }
    }
    if i <= value_start {
        return None;
    }
    Some(json[value_start..i].to_string())
}

/// The `type` field of a JSON frame, peeked without decoding.
fn extract_event_type(json: &str) -> Option<String> {
    extract_field(json, "type")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_simple_frame() {
        let mut parser = Parser::default();
        let events = parser.push(b"event: run.started\ndata: {\"run_id\":\"r1\"}\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event, "run.started");
        assert_eq!(events[0].data, "{\"run_id\":\"r1\"}");
    }

    #[test]
    fn joins_multi_line_data_and_defaults_the_name() {
        let mut parser = Parser::default();
        let events = parser.push(b"data: one\ndata: two\n\n");
        assert_eq!(events[0].event, "message");
        assert_eq!(events[0].data, "one\ntwo");
    }

    #[test]
    fn survives_chunk_boundaries_and_crlf() {
        let mut parser = Parser::default();
        assert!(parser.push(b"event: par").is_empty());
        assert!(parser.push(b"tial\r\ndata: {\"a\":").is_empty());
        let events = parser.push(b"1}\r\n\r\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event, "partial");
        assert_eq!(events[0].data, "{\"a\":1}");
    }

    #[test]
    fn ignores_comments_and_unknown_fields() {
        let mut parser = Parser::default();
        let events = parser.push(b": keep-alive\nfoo: bar\ndata: hello\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "hello");
    }

    #[test]
    fn keeps_the_id_field() {
        let mut parser = Parser::default();
        let events = parser.push(b"id: 42\ndata: x\n\n");
        assert_eq!(events[0].id.as_deref(), Some("42"));
    }

    #[test]
    fn decodes_a_comment_json_frame() {
        let mut parser = Parser::default();
        let events = parser.push(b":{\"type\":\"progress\",\"event_id\":\"2\",\"pct\":10}\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event, "progress");
        assert_eq!(events[0].id.as_deref(), Some("2"));
        assert_eq!(events[0].data, "{\"type\":\"progress\",\"event_id\":\"2\",\"pct\":10}");
    }

    #[test]
    fn decodes_a_bare_ndjson_line() {
        let mut parser = Parser::default();
        let events = parser.push(b"{\"type\":\"progress\",\"event_id\":\"3\",\"pct\":20}\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event, "progress");
        assert_eq!(events[0].id.as_deref(), Some("3"));
    }

    #[test]
    fn done_frame_terminates_without_itself_emitting() {
        let mut parser = Parser::default();
        let events = parser.push(b"data: {\"text\":\"hi\"}\n\ndata: [DONE]\n\n");
        assert_eq!(events.len(), 1, "the [DONE] frame emits nothing on its own");
        assert_eq!(events[0].data, "{\"text\":\"hi\"}");
        assert!(parser.is_done());
    }

    #[test]
    fn an_id_or_retry_only_frame_emits_nothing() {
        let mut parser = Parser::default();
        let events = parser.push(b"id: 99\nretry: 500\n\ndata: later\n\n");
        assert_eq!(events.len(), 1, "the id/retry-only frame must not emit");
        assert_eq!(events[0].data, "later");
        assert_eq!(events[0].id.as_deref(), None, "id is per-frame: not carried from the id-only frame");
    }

    #[test]
    fn id_is_per_frame_and_does_not_leak_across_frames() {
        let mut parser = Parser::default();
        let events = parser.push(b"id: 4\ndata: first\n\ndata: second\n\n");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].id.as_deref(), Some("4"));
        assert_eq!(events[1].id.as_deref(), None, "the second frame had no id: line");
    }

    #[test]
    fn done_frame_with_only_an_id_emits_nothing() {
        let mut parser = Parser::default();
        let events = parser.push(b"id: 7\ndata: [DONE]\n\n");
        assert!(events.is_empty(), "no data: → nothing to emit, even with id");
        assert!(parser.is_done());
    }

    #[derive(serde::Deserialize, PartialEq, Debug)]
    struct ExpectedEvent {
        id: Option<String>,
        event: String,
        data: String,
        retry: Option<u64>,
    }

    #[test]
    fn decodes_the_shared_mixed_format_fixture_to_the_locked_expected_output() {
        // Kotlin locks mixed.expected.json; the four SDK ports replay the same
        // bytes and must match. A parser that dropped comments or unknown lines
        // (the stock SDK parser) would emit only the standard frames here.
        // Embedded at compile time so the test is independent of the cwd that
        // `cargo test` happens to run from.
        let mixed = include_str!("../../../contract/sse-fixtures/mixed.txt");
        let expected: Vec<ExpectedEvent> =
            serde_json::from_str(include_str!("../../../contract/sse-fixtures/mixed.expected.json"))
                .expect("expected fixture is valid JSON");

        let mut parser = Parser::default();
        let mut events = parser.push(mixed.as_bytes());
        if let Some(trailing) = parser.finish() {
            events.push(trailing);
        }

        assert_eq!(events.len(), expected.len(), "event count");
        for (got, want) in events.iter().zip(expected.iter()) {
            assert_eq!(got.id, want.id, "id mismatch");
            assert_eq!(got.event, want.event, "event mismatch");
            assert_eq!(got.data, want.data, "data mismatch");
            assert_eq!(got.retry, want.retry, "retry mismatch");
        }
        assert!(parser.is_done(), "fixture ends with [DONE]");
    }

    #[test]
    fn extract_field_honours_escaped_quotes() {
        let json = r#"{"type":"x","msg":"she said \"hi\""}"#;
        assert_eq!(extract_field(json, "type").as_deref(), Some("x"));
        assert_eq!(extract_field(json, "msg").as_deref(), Some(r#"she said \"hi\""#));
    }
}