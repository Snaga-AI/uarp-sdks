"""Encoding helpers shared by the generated code and the transport.

Every SDK of this family has to put the same bytes on the wire for the same
call; `contract/run.sh` compares them. So these follow the TypeScript SDK's
rules exactly, including the places where Python's own defaults differ
(`str(True)` is `True`, `str(1.0)` is `1.0`, `urllib.parse.quote` leaves `~`
alone).
"""

from __future__ import annotations

import json
import math
import random
import uuid
from decimal import Decimal
from email.utils import parsedate_to_datetime
from typing import Any, Iterable, List, Mapping, Optional, Sequence, Tuple

_UNRESERVED = frozenset(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
#  The WHATWG form serializer's set: `*` stays, `~` does not.
_FORM_SAFE = frozenset(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789*-._")


def encode_path(value: str) -> str:
    """Percent-encode one path segment.

    Everything outside the RFC 3986 unreserved set is escaped, `/` included, so
    an identifier with a slash in it cannot leave its segment.
    """
    return "".join(chr(byte) if byte in _UNRESERVED else f"%{byte:02X}" for byte in value.encode("utf-8"))


def encode_query_component(value: str) -> str:
    """Percent-encode one query name or value.

    Stricter than a URL needs: a sub-delimiter such as `+` or `*` is legal in a
    query, but a form-decoding server reads it back differently.
    """
    return encode_path(value)


def json_text(value: Any) -> str:
    """JSON as `JSON.stringify` writes it: no spaces, non-ASCII kept as it is."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def number_text(value: float) -> str:
    """A float as JavaScript's `String(number)` writes it (`1`, not `1.0`)."""
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    if value == 0:
        return "0"
    magnitude = abs(value)
    if 1e-6 <= magnitude < 1e21:
        #  The shortest round-tripping digits, written out without an exponent.
        text = format(Decimal(repr(value)), "f")
        if "." in text:
            text = text.rstrip("0").rstrip(".")
        return text
    mantissa, _, exponent = repr(value).partition("e")
    if mantissa.endswith(".0"):
        mantissa = mantissa[:-2]
    sign = "-" if exponent.startswith("-") else "+"
    return f"{mantissa}e{sign}{exponent.lstrip('+-').lstrip('0') or '0'}"


def scalar_text(value: Any) -> str:
    """How a query, header, path or form value is written as text.

    A string as it is, `true`/`false` in lower case, a number as JavaScript
    writes it, and an object or an array as JSON.
    """
    #  An enum member is a `str`; its text is its value.
    if isinstance(value, str):
        return str.__str__(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return number_text(value)
    from ._models import encode

    return json_text(encode(value))


def build_query(pairs: Iterable[Tuple[str, Any]]) -> str:
    """Serialise query parameters; an array repeats the key, `None` is left out."""
    out: List[str] = []
    for name, value in pairs:
        if value is None:
            continue
        values: Sequence[Any] = value if isinstance(value, (list, tuple)) else (value,)
        for item in values:
            if item is None:
                continue
            out.append(f"{encode_query_component(name)}={encode_query_component(scalar_text(item))}")
    return "&".join(out)


def form_component(value: str) -> str:
    """The WHATWG `application/x-www-form-urlencoded` serializer, as `URLSearchParams` uses it."""
    out: List[str] = []
    for byte in value.encode("utf-8"):
        if byte == 0x20:
            out.append("+")
        elif byte in _FORM_SAFE:
            out.append(chr(byte))
        else:
            out.append(f"%{byte:02X}")
    return "".join(out)


def encode_form(fields: Iterable[Tuple[str, Any]]) -> bytes:
    """A form body: the fields in the order given, absent and null ones left out."""
    pairs = [
        f"{form_component(name)}={form_component(scalar_text(value))}" for name, value in fields if value is not None
    ]
    return "&".join(pairs).encode("ascii")


def join_url(base_url: str, path: str) -> str:
    """Join a base URL and a path without doubling or dropping a slash."""
    lowered = path.lower()
    if lowered.startswith("http://") or lowered.startswith("https://"):
        return path
    return base_url.rstrip("/") + "/" + path.lstrip("/")


def parse_retry_after(headers: Mapping[str, str]) -> Optional[float]:
    """`Retry-After` in seconds, accepting both the delta and the HTTP-date form."""
    raw = headers.get("retry-after")
    if raw is None:
        return None
    try:
        seconds = float(raw)
    except ValueError:
        try:
            moment = parsedate_to_datetime(raw)
        except (TypeError, ValueError):
            return None
        import datetime

        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=datetime.timezone.utc)
        return max(0.0, (moment - datetime.datetime.now(datetime.timezone.utc)).total_seconds())
    if not math.isfinite(seconds):
        return None
    return max(0.0, seconds)


def backoff_delay(attempt: int) -> float:
    """Full-jitter exponential backoff for unary retries, capped at 8 s."""
    capped = min(8.0, 0.5 * 2.0**attempt)
    return capped * (0.5 + random.random() * 0.5)


def stream_backoff_delay(attempt: int, base: float, maximum: float) -> float:
    """Backoff for event-stream reconnects: `max_sleep/2 + rand(0..max_sleep/2)`.

    It climbs with the attempts, and clients do not all wake on the same
    boundary. The same formula as the other SDKs' stream backoff.
    """
    exponential = base * 2.0 ** max(attempt - 1, 0)
    max_sleep = min(maximum, exponential)
    half = max(max_sleep / 2, 0.001)
    return half + random.random() * half


def random_id() -> str:
    """A v4 UUID, the default `Idempotency-Key`."""
    return str(uuid.uuid4())


def path_segment(value: Any) -> str:
    """A path parameter, written as text and percent-encoded as one segment."""
    return encode_path(scalar_text(value))
