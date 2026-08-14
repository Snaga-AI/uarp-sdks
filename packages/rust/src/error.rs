//! Error types. Every fallible SDK call returns [`Result<T>`].

use std::collections::HashMap;
use std::fmt;

use serde::{Deserialize, Serialize};

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Everything that can go wrong while talking to the platform.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The server answered with a non-2xx status.
    ///
    /// Boxed so that `Result<T, Error>` stays small on the happy path.
    #[error(transparent)]
    Api(Box<ApiError>),

    /// The request never reached the server, or the connection dropped.
    #[error("connection error: {0}")]
    Connection(#[source] reqwest::Error),

    /// The request exceeded the configured timeout.
    #[error("request timed out")]
    Timeout,

    /// The response body could not be decoded into the expected type.
    #[error("failed to decode response body: {0}")]
    Decode(#[source] serde_json::Error),

    /// The client was configured with something unusable (bad URL, missing key).
    #[error("invalid client configuration: {0}")]
    Config(String),

    /// A query string or multipart body could not be encoded.
    #[error("failed to encode request: {0}")]
    Encode(String),

    /// The event stream ended in the middle of a frame or could not be read.
    #[error("event stream error: {0}")]
    Stream(String),
}

impl From<ApiError> for Error {
    fn from(error: ApiError) -> Self {
        Error::Api(Box::new(error))
    }
}

impl Error {
    /// The HTTP status, when the failure came from the server.
    pub fn status(&self) -> Option<u16> {
        match self {
            Error::Api(err) => Some(err.status),
            _ => None,
        }
    }

    /// Whether retrying the very same request could plausibly succeed.
    pub fn is_retryable(&self) -> bool {
        match self {
            Error::Api(err) => err.is_retryable(),
            Error::Connection(_) | Error::Timeout => true,
            _ => false,
        }
    }
}

/// RFC 9457 problem document returned by the API on failure.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Problem {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Request identifier to quote when reporting an incident.
    #[serde(rename = "correlationId", default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    /// Field-level validation failures, present on 422 responses.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<FieldError>,
    /// Anything else the server included.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldError {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// A coarse classification of an [`ApiError`], convenient for `match`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ApiErrorKind {
    BadRequest,
    Authentication,
    PermissionDenied,
    NotFound,
    Conflict,
    Gone,
    PayloadTooLarge,
    UnprocessableEntity,
    RateLimit,
    ServiceUnavailable,
    Server,
    Other,
}

/// A non-2xx response, with the parsed problem document attached.
#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: u16,
    pub problem: Problem,
    /// Selected response headers (lower-cased names).
    pub headers: HashMap<String, String>,
}

impl ApiError {
    pub fn kind(&self) -> ApiErrorKind {
        match self.status {
            400 => ApiErrorKind::BadRequest,
            401 => ApiErrorKind::Authentication,
            403 => ApiErrorKind::PermissionDenied,
            404 => ApiErrorKind::NotFound,
            409 => ApiErrorKind::Conflict,
            410 => ApiErrorKind::Gone,
            413 => ApiErrorKind::PayloadTooLarge,
            422 => ApiErrorKind::UnprocessableEntity,
            429 => ApiErrorKind::RateLimit,
            503 => ApiErrorKind::ServiceUnavailable,
            status if status >= 500 => ApiErrorKind::Server,
            _ => ApiErrorKind::Other,
        }
    }

    /// Request identifier for support tickets.
    pub fn correlation_id(&self) -> Option<&str> {
        self.problem
            .correlation_id
            .as_deref()
            .or_else(|| self.headers.get("x-correlation-id").map(String::as_str))
    }

    /// Seconds the server asked the client to wait, from `Retry-After`.
    pub fn retry_after_seconds(&self) -> Option<f64> {
        self.headers.get("retry-after")?.parse().ok()
    }

    /// Remaining requests in the current rate-limit window.
    pub fn rate_limit_remaining(&self) -> Option<i64> {
        self.headers.get("x-ratelimit-remaining")?.parse().ok()
    }

    pub fn is_retryable(&self) -> bool {
        matches!(self.status, 408 | 409 | 429 | 500 | 502 | 503 | 504)
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let title = self.problem.title.as_deref().unwrap_or("HTTP error");
        write!(f, "{} {}", self.status, title)?;
        if let Some(detail) = &self.problem.detail {
            write!(f, " — {detail}")?;
        }
        if let Some(correlation) = self.correlation_id() {
            write!(f, " (correlationId: {correlation})")?;
        }
        Ok(())
    }
}

impl std::error::Error for ApiError {}
