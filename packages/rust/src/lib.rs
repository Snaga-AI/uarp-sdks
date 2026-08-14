//! Async Rust client for the UARP (Snaga) Universal Agent Runtime Platform.
//!
//! ```no_run
//! use futures_util::StreamExt;
//!
//! #[tokio::main]
//! async fn main() -> Result<(), uarp_sdk::Error> {
//!     let client = uarp_sdk::Client::from_env()?;
//!     let agents = client.agents();
//!     let params = uarp_sdk::api::ListAgentsParams { limit: Some(50), ..Default::default() };
//!
//!     // Every item across every page.
//!     let mut all = std::pin::pin!(agents.list_all(&params));
//!     while let Some(agent) = all.next().await {
//!         println!("{:?}", agent?.name);
//!     }
//!     Ok(())
//! }
//! ```
//!
//! The API surface under [`api`] is generated from `spec/openapi.json`; the
//! transport, error, pagination and SSE layers are hand-written.

#![forbid(unsafe_code)]
#![warn(missing_debug_implementations)]

mod client;
mod error;
mod multipart;
mod pagination;
mod sse;
mod util;

#[rustfmt::skip]
mod generated;

pub use client::{Client, ClientBuilder, Request, RequestOptions, NO_BODY, NO_QUERY};
pub use error::{ApiError, ApiErrorKind, Error, FieldError, Problem, Result};
pub use multipart::FilePart;
pub use sse::{Event, EventStream, StreamOptions};

pub use generated::meta::{DEFAULT_BASE_URL, SCOPES, SPEC_VERSION};
pub use generated::models;

/// One module per OpenAPI tag, each with its own `*Api` accessor on [`Client`].
pub mod api {
    pub use crate::generated::api::*;
}

/// The version of this crate.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
