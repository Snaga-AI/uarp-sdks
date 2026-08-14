//! Helpers for the handful of `multipart/form-data` endpoints.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// A file to upload. `data` is sent verbatim as the part body.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FilePart {
    /// Filename advertised in the `Content-Disposition` header.
    pub filename: String,
    /// MIME type; defaults to `application/octet-stream`.
    pub content_type: Option<String>,
    pub data: Vec<u8>,
}

impl FilePart {
    pub fn new(filename: impl Into<String>, data: impl Into<Vec<u8>>) -> Self {
        Self { filename: filename.into(), content_type: None, data: data.into() }
    }

    pub fn content_type(mut self, content_type: impl Into<String>) -> Self {
        self.content_type = Some(content_type.into());
        self
    }

    /// Read a file from disk, using its name as the part filename.
    pub fn from_path(path: impl AsRef<std::path::Path>) -> std::io::Result<Self> {
        let path = path.as_ref();
        let filename = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".to_string());
        Ok(Self::new(filename, std::fs::read(path)?))
    }

    pub(crate) fn into_part(self) -> Result<reqwest::multipart::Part> {
        let part = reqwest::multipart::Part::bytes(self.data).file_name(self.filename);
        match self.content_type {
            Some(mime) => part.mime_str(&mime).map_err(|err| Error::Encode(err.to_string())),
            None => Ok(part),
        }
    }
}

/// Render a scalar field for a multipart form.
///
/// Strings are sent as-is; everything else is JSON-encoded, which matches how
/// the platform parses structured form fields.
pub(crate) fn field_text<T: Serialize>(value: &T) -> Result<String> {
    match serde_json::to_value(value).map_err(|err| Error::Encode(err.to_string()))? {
        serde_json::Value::String(text) => Ok(text),
        serde_json::Value::Null => Ok(String::new()),
        other => Ok(other.to_string()),
    }
}
