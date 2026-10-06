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

/**
 * Serialise form fields the way the WHATWG URL standard's
 * `application/x-www-form-urlencoded` serializer does — the one
 * `URLSearchParams` uses — so the five SDKs put the same bytes on the wire.
 */
internal fun encodeForm(fields: List<Pair<String, String>>): String =
    fields.joinToString("&") { (name, value) -> encodeFormComponent(name) + "=" + encodeFormComponent(value) }

/**
 * One form name or value: a space becomes `+`, `A-Z a-z 0-9 * - . _` stay, and
 * every other UTF-8 byte becomes `%XX` in upper case — `~` included, which RFC
 * 3986 would leave alone and this serializer does not. Not `URLEncoder`: its
 * set is close to this one, and close is a different body.
 */
internal fun encodeFormComponent(value: String): String {
    val out = StringBuilder(value.length)
    for (byte in value.toByteArray(Charsets.UTF_8)) {
        val code = byte.toInt() and 0xFF
        when {
            code == 0x20 -> out.append('+')
            code in 'A'.code..'Z'.code || code in 'a'.code..'z'.code || code in '0'.code..'9'.code ||
                code == '*'.code || code == '-'.code || code == '.'.code || code == '_'.code -> out.append(code.toChar())
            else -> out.append('%').append(HEX[code shr 4]).append(HEX[code and 0x0F])
        }
    }
    return out.toString()
}

private const val HEX = "0123456789ABCDEF"

/**
 * The fields of an encoded model, in declaration order — which the generator
 * keeps to the schema's. Null is skipped (absent fields never reach here);
 * a string goes as is, a number or boolean as its literal, and an object or
 * array as JSON text, as the TypeScript SDK sends them.
 */
@PublishedApi
internal fun formFieldsOf(element: kotlinx.serialization.json.JsonElement): List<Pair<String, String>> {
    val fields = element as? kotlinx.serialization.json.JsonObject
        ?: throw IllegalArgumentException("a form body must be an object, not ${element::class.simpleName}")
    return fields.mapNotNull { (name, value) ->
        if (value is kotlinx.serialization.json.JsonNull) null else name to formValueOf(value)
    }
}

/** One field's text: a string's content, a number's or boolean's literal, else JSON. */
@PublishedApi
internal fun formValueOf(value: kotlinx.serialization.json.JsonElement): String = when (value) {
    is kotlinx.serialization.json.JsonNull -> ""
    is kotlinx.serialization.json.JsonPrimitive -> value.content
    else -> value.toString()
}
