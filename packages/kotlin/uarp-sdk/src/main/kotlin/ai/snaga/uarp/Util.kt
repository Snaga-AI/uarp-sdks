package ai.snaga.uarp

private const val UNRESERVED = "-._~"

/**
 * Percent-encode a value for use as a single URL path segment.
 *
 * Everything outside the RFC 3986 unreserved set is escaped, including `/`, so
 * an identifier containing a slash cannot escape its segment.
 */
public fun encodePathSegment(value: String): String = encodeComponent(value)

/**
 * Percent-encode one query name or value.
 *
 * Deliberately strict: everything outside the RFC 3986 unreserved set is
 * escaped. Leaving a sub-delimiter such as `+` or `*` unescaped is legal in a
 * URL but changes what a form-decoding server reads back, and the five SDKs
 * have to agree byte for byte.
 */
public fun encodeQueryComponent(value: String): String = encodeComponent(value)

private fun encodeComponent(value: String): String {
    val out = StringBuilder(value.length)
    for (byte in value.toByteArray(Charsets.UTF_8)) {
        val char = byte.toInt().toChar()
        if (char.isLetterOrDigit() && char.code < 128 || char in UNRESERVED) {
            out.append(char)
        } else {
            out.append('%').append("%02X".format(byte.toInt() and 0xFF))
        }
    }
    return out.toString()
}
