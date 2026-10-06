//! `application/x-www-form-urlencoded` request bodies.
//!
//! The generated code lists a form's fields in schema order and renders each
//! with [`form_text`]; [`encode_form`] then writes the body the way the WHATWG
//! URL standard's serializer does, the one `URLSearchParams` uses, so the five
//! SDKs put the same bytes on the wire.

use serde::Serialize;

use crate::error::{Error, Result};

/// The `Content-Type` of a form body, exactly.
pub(crate) const FORM_CONTENT_TYPE: &str = "application/x-www-form-urlencoded";

/// Render one field's value, or `None` when it is absent or null and must not
/// appear at all.
///
/// The rule TypeScript's transport applies: a string as it is, an object or an
/// array as JSON, anything else as its plain text (`true`, `42`).
pub(crate) fn form_text<T: Serialize + ?Sized>(value: &T) -> Result<Option<String>> {
    let encode = |err: serde_json::Error| Error::Encode(err.to_string());
    match serde_json::to_value(value).map_err(encode)? {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::String(text) => Ok(Some(text)),
        //  Serialised again from the value itself rather than from the
        //  `Value`: a `Value` object sorts its keys, the struct does not.
        serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
            serde_json::to_string(value).map(Some).map_err(encode)
        }
        other => Ok(Some(other.to_string())),
    }
}

/// The WHATWG `application/x-www-form-urlencoded` serializer: pairs joined
/// with `&`, a space as `+`, `A-Z a-z 0-9 * - . _` as they are, and every
/// other UTF-8 byte as upper-case `%XX`, `~` included.
pub(crate) fn encode_form<'a>(fields: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    form_urlencoded::Serializer::new(String::new())
        .extend_pairs(fields)
        .finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_like_url_search_params() {
        //  The bytes contract/SCENARIOS.md expects for scenario 20.
        let user = r#"{"name":"А Б","email":"a@b.c"}"#;
        let body = encode_form([("code", "c 1+2"), ("state", "s/ы&=~*"), ("user", user)]);
        assert_eq!(
            body,
            "code=c+1%2B2&state=s%2F%D1%8B%26%3D%7E*&user=%7B%22name%22%3A%22%D0%90+%D0%91%22%2C%22email%22%3A%22a%40b.c%22%7D"
        );
    }

    #[test]
    fn keeps_exactly_the_unreserved_set() {
        assert_eq!(encode_form([("k", "AZaz09*-._")]), "k=AZaz09*-._");
        assert_eq!(encode_form([("k", "~!'()")]), "k=%7E%21%27%28%29");
    }

    #[test]
    fn renders_values_like_typescript() {
        #[derive(Serialize)]
        struct Nested {
            z: u8,
            a: u8,
        }
        assert_eq!(form_text("plain").unwrap().as_deref(), Some("plain"));
        assert_eq!(form_text(&None::<String>).unwrap(), None);
        assert_eq!(form_text(&serde_json::Value::Null).unwrap(), None);
        assert_eq!(form_text(&true).unwrap().as_deref(), Some("true"));
        assert_eq!(form_text(&42).unwrap().as_deref(), Some("42"));
        assert_eq!(form_text(&vec![1, 2]).unwrap().as_deref(), Some("[1,2]"));
        //  Declaration order, as `JSON.stringify` keeps insertion order.
        assert_eq!(
            form_text(&Nested { z: 1, a: 2 }).unwrap().as_deref(),
            Some(r#"{"z":1,"a":2}"#)
        );
    }
}
