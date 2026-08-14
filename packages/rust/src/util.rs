//! Small utilities shared by the generated code.

/// Percent-encode a value for use as a single URL path segment.
///
/// Everything outside the RFC 3986 unreserved set is escaped, including `/`,
/// so an identifier containing a slash cannot escape its segment.
pub fn encode_path(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => out.push(*byte as char),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// Percent-encode one query name or value.
///
/// Deliberately strict: everything outside the RFC 3986 unreserved set is
/// escaped. Leaving a sub-delimiter such as `+` or `*` unescaped is legal in a
/// URL but changes what a form-decoding server reads back, and the five SDKs
/// have to agree byte for byte.
pub fn encode_query_component(value: &str) -> String {
    //  The rule is the same as for a path segment.
    encode_path(value)
}

#[cfg(test)]
mod tests {
    use super::encode_path;

    #[test]
    fn escapes_reserved_characters() {
        assert_eq!(encode_path("plain-id_1.2~3"), "plain-id_1.2~3");
        assert_eq!(encode_path("id with/slash"), "id%20with%2Fslash");
        assert_eq!(encode_path("../etc"), "..%2Fetc");
    }

    #[test]
    fn escapes_multibyte_characters() {
        assert_eq!(encode_path("агент"), "%D0%B0%D0%B3%D0%B5%D0%BD%D1%82");
    }
}
