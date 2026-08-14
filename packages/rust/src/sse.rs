//! Server-sent events: incremental frame parsing plus a reconnecting [`Stream`].

use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use futures_core::Stream;
use futures_util::StreamExt;
use serde::de::DeserializeOwned;

use crate::client::{backoff, collect_headers, Inner};
use crate::error::{ApiError, Error, Problem, Result};

/// One decoded `text/event-stream` frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    /// `id:` field, replayed as `Last-Event-ID` when the stream reconnects.
    pub id: Option<String>,
    /// `event:` field; defaults to `message`.
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

/// Reconnection behaviour for [`EventStream`].
#[derive(Debug, Clone, Copy)]
pub struct StreamOptions {
    /// Reconnect (replaying `Last-Event-ID`) when the stream ends. Default `true`.
    pub reconnect: bool,
    /// Reconnect attempts without progress before giving up. Default `5`.
    pub max_reconnects: u32,
}

impl Default for StreamOptions {
    fn default() -> Self {
        Self { reconnect: true, max_reconnects: 5 }
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
        let stream = async_stream::try_stream! {
            let url = url?;
            let mut last_event_id: Option<String> = None;
            let mut attempt: u32 = 0;

            loop {
                let mut builder = client
                    .http
                    .request(reqwest::Method::GET, url.clone())
                    .header(reqwest::header::ACCEPT, "text/event-stream")
                    .header(reqwest::header::USER_AGENT, &client.user_agent)
                    .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", client.api_key))
                    .headers(client.default_headers.clone());
                for (name, value) in &headers {
                    builder = builder.header(name.as_str(), value);
                }
                if let Some(id) = &last_event_id {
                    builder = builder.header("Last-Event-ID", id);
                }

                let response = builder.send().await.map_err(|err| {
                    if err.is_timeout() { Error::Timeout } else { Error::Connection(err) }
                })?;

                if !response.status().is_success() {
                    let status = response.status().as_u16();
                    let response_headers = collect_headers(response.headers());
                    let problem = response
                        .bytes()
                        .await
                        .ok()
                        .and_then(|bytes| serde_json::from_slice::<Problem>(&bytes).ok())
                        .unwrap_or_default();
                    Err(Error::from(ApiError { status, problem, headers: response_headers }))?;
                    break;
                }

                // A connection that delivered at least one event counts as
                // progress and resets the reconnect budget; one that closed
                // immediately does not, so a flapping server cannot spin here.
                let mut delivered = false;
                let mut parser = Parser::default();
                let mut body = response.bytes_stream();
                while let Some(chunk) = body.next().await {
                    let chunk = chunk.map_err(Error::Connection)?;
                    for event in parser.push(&chunk) {
                        if event.id.is_some() {
                            last_event_id.clone_from(&event.id);
                        }
                        delivered = true;
                        yield event;
                    }
                }
                if let Some(event) = parser.finish() {
                    if event.id.is_some() {
                        last_event_id.clone_from(&event.id);
                    }
                    delivered = true;
                    yield event;
                }
                if delivered {
                    attempt = 0;
                }

                if !options.reconnect || attempt >= options.max_reconnects {
                    break;
                }
                tokio::time::sleep(backoff(attempt)).await;
                attempt = attempt.saturating_add(1);
                continue;
            }
        };
        Self { inner: Box::pin(stream) }
    }
}

impl Stream for EventStream {
    type Item = Result<Event>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.inner.as_mut().poll_next(cx)
    }
}

/// Incremental `text/event-stream` decoder.
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
}

impl Parser {
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
        }
        events
    }

    /// Flush a frame left unterminated when the connection closed.
    pub(crate) fn finish(&mut self) -> Option<Event> {
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
        if line.starts_with(':') {
            return None; // comment / keep-alive
        }
        let (field, value) = match line.find(':') {
            Some(index) => (&line[..index], line[index + 1..].strip_prefix(' ').unwrap_or(&line[index + 1..])),
            None => (line, ""),
        };
        self.has_fields = true;
        match field {
            "event" => self.event = value.to_string(),
            "data" => self.data.push(value.to_string()),
            "id" => {
                if !value.contains('\0') {
                    self.id = Some(value.to_string());
                }
            }
            "retry" => self.retry = value.parse().ok(),
            _ => {}
        }
        None
    }

    fn dispatch(&mut self) -> Option<Event> {
        if !self.has_fields {
            return None;
        }
        let event = Event {
            id: self.id.clone(),
            event: if self.event.is_empty() { "message".to_string() } else { std::mem::take(&mut self.event) },
            data: self.data.join("\n"),
            retry: self.retry.take(),
        };
        self.data.clear();
        self.event.clear();
        self.has_fields = false;
        Some(event)
    }
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
}
