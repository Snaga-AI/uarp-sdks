"""Errors. Everything this SDK raises derives from `UarpError`."""

from __future__ import annotations

import dataclasses
from typing import Any, Dict, List, Mapping, Optional


class UarpError(Exception):
    """Base class of every error this SDK raises."""


class APIConnectionError(UarpError):
    """The request never produced an HTTP response (DNS, TLS, a dropped socket)."""

    def __init__(self, message: str = "Connection error") -> None:
        super().__init__(message)


class APITimeoutError(APIConnectionError):
    """The request exceeded its timeout."""

    def __init__(self, message: str = "Request timed out") -> None:
        super().__init__(message)


class DecodeError(UarpError):
    """A response body did not have the shape the SDK expected.

    `body` holds what the server sent, already parsed when it was JSON, so a
    caller can still reach the data while the mismatch is reported.
    """

    def __init__(self, message: str, *, path: str = "$", body: Any = None) -> None:
        super().__init__(message)
        self.path = path
        self.body = body


class EncodeError(UarpError):
    """A request could not be encoded (a file in a JSON body, an unsupported value)."""


class ConfigError(UarpError):
    """The client was configured with something unusable, such as no API key."""


@dataclasses.dataclass
class FieldError:
    field: Optional[str] = None
    message: Optional[str] = None


@dataclasses.dataclass
class Problem:
    """RFC 9457 problem document the API returns on failure."""

    type: Optional[str] = None
    title: Optional[str] = None
    status: Optional[int] = None
    detail: Optional[str] = None
    #: What a client should do about the failure, as a stable value to switch on
    #: (`SESSION_NOT_ACTIVE`, `QUOTA_EXCEEDED`, `resource_limit_reached`, …). A
    #: string rather than an enum, so a code added after this SDK was built
    #: still reaches the caller.
    code: Optional[str] = None
    #: Request identifier to quote when reporting an incident.
    correlation_id: Optional[str] = None
    #: Field-level validation failures, present on 422 responses.
    errors: List[FieldError] = dataclasses.field(default_factory=list)
    #: Every other member the server sent (`session_status`, `reason`,
    #: `retry_after`, …), as sent.
    extensions: Dict[str, Any] = dataclasses.field(default_factory=dict)

    @classmethod
    def from_json(cls, body: Mapping[str, Any]) -> "Problem":
        def text(key: str) -> Optional[str]:
            value = body.get(key)
            return value if isinstance(value, str) else None

        status = body.get("status")
        errors: List[FieldError] = []
        raw_errors = body.get("errors")
        if isinstance(raw_errors, list):
            for entry in raw_errors:
                if isinstance(entry, dict):
                    field = entry.get("field")
                    message = entry.get("message")
                    errors.append(
                        FieldError(
                            field=field if isinstance(field, str) else None,
                            message=message if isinstance(message, str) else None,
                        )
                    )
        known = {"type", "title", "status", "detail", "code", "correlation_id", "correlationId", "errors"}
        return cls(
            type=text("type"),
            title=text("title"),
            status=status if isinstance(status, int) and not isinstance(status, bool) else None,
            detail=text("detail"),
            code=text("code"),
            #  `correlationId` is the old spelling, sent for a compatibility window.
            correlation_id=text("correlation_id") or text("correlationId"),
            errors=errors,
            extensions={key: value for key, value in body.items() if key not in known},
        )


class APIError(UarpError):
    """The server answered with a non-2xx status."""

    def __init__(self, status: int, problem: Problem, headers: Mapping[str, str]) -> None:
        self.status = status
        self.problem = problem
        #: Response headers, names lower-cased.
        self.headers: Dict[str, str] = {key.lower(): value for key, value in headers.items()}
        super().__init__(self._message())

    @property
    def code(self) -> Optional[str]:
        """The stable code to switch on, e.g. `SESSION_NOT_ACTIVE`."""
        return self.problem.code

    @property
    def reason(self) -> Optional[str]:
        """Why, when the code alone does not say.

        A refused `X-Active-Tenant` answers 403 `FORBIDDEN` with `not_a_member`
        or `membership_suspended`. The problem's `reason` member, when it is a
        string.
        """
        value = self.problem.extensions.get("reason")
        return value if isinstance(value, str) else None

    @property
    def correlation_id(self) -> Optional[str]:
        """The request id: from the problem document, or the `X-Request-Id` header."""
        return self.problem.correlation_id or self.headers.get("x-request-id") or self.headers.get("x-correlation-id")

    @property
    def request_id(self) -> Optional[str]:
        return self.headers.get("x-request-id")

    @property
    def validation_errors(self) -> List[FieldError]:
        """Field-level validation failures, present on 422 responses."""
        return self.problem.errors

    @property
    def is_retryable(self) -> bool:
        """Whether retrying the very same request could plausibly succeed."""
        return self.status in (408, 409, 429, 500, 502, 503, 504)

    def _message(self) -> str:
        title = self.problem.title or f"HTTP {self.status}"
        detail = f" — {self.problem.detail}" if self.problem.detail else ""
        correlation = f" (correlationId: {self.problem.correlation_id})" if self.problem.correlation_id else ""
        return f"{self.status} {title}{detail}{correlation}"


class BadRequestError(APIError):
    pass


class AuthenticationError(APIError):
    pass


class PermissionDeniedError(APIError):
    pass


class NotFoundError(APIError):
    pass


class ConflictError(APIError):
    pass


class GoneError(APIError):
    pass


class PayloadTooLargeError(APIError):
    pass


class UnprocessableEntityError(APIError):
    pass


class InternalServerError(APIError):
    pass


class ServiceUnavailableError(InternalServerError):
    pass


class RateLimitError(APIError):
    @property
    def retry_after_seconds(self) -> Optional[float]:
        """Seconds the server asked the client to wait, when it said so."""
        return _float(self.headers.get("retry-after"))

    @property
    def limit(self) -> Optional[int]:
        """Requests allowed in the current window, from `X-RateLimit-Limit`."""
        return _int(self.headers.get("x-ratelimit-limit"))

    @property
    def remaining(self) -> Optional[int]:
        return _int(self.headers.get("x-ratelimit-remaining"))

    @property
    def reset(self) -> Optional[int]:
        """Unix seconds at which the window resets, from `X-RateLimit-Reset`."""
        return _int(self.headers.get("x-ratelimit-reset"))


def _float(raw: Optional[str]) -> Optional[float]:
    if raw is None:
        return None
    try:
        return float(raw.strip())
    except ValueError:
        return None


def _int(raw: Optional[str]) -> Optional[int]:
    if raw is None:
        return None
    try:
        return int(raw.strip())
    except ValueError:
        return None


_BY_STATUS = {
    400: BadRequestError,
    401: AuthenticationError,
    403: PermissionDeniedError,
    404: NotFoundError,
    409: ConflictError,
    410: GoneError,
    413: PayloadTooLargeError,
    422: UnprocessableEntityError,
    429: RateLimitError,
    503: ServiceUnavailableError,
}


def error_for_status(status: int, problem: Problem, headers: Mapping[str, str]) -> APIError:
    kind = _BY_STATUS.get(status)
    if kind is None:
        kind = InternalServerError if status >= 500 else APIError
    return kind(status, problem, headers)


#: RFC 9457 keys. A body carrying none of them is not a problem document,
#: however well-formed its JSON is.
_PROBLEM_KEYS = ("type", "title", "status", "detail", "code", "correlation_id", "correlationId", "errors")


def problem_from_bytes(status: int, body: bytes) -> Problem:
    """The failure, whatever shape the server used to send it.

    The API answers a few dozen places with a bare `{"error": "..."}` instead of
    a problem document. Read as one, it has no title and no detail, and the
    actual reason ("Insufficient role: ...") would be gone before any caller
    saw it. A body that is not JSON at all (an HTML error page from a proxy) is
    still a message.
    """
    import json

    if not body:
        return Problem(status=status)
    text = body.decode("utf-8", "replace")
    try:
        parsed = json.loads(text)
    except ValueError:
        return Problem(status=status, detail=text[:2000])
    if isinstance(parsed, dict):
        if any(key in parsed for key in _PROBLEM_KEYS):
            return Problem.from_json(parsed)
        return Problem(status=status, detail=_message_from(parsed) or text[:2000])
    return Problem(status=status, detail=text[:2000])


def _message_from(body: Mapping[str, Any]) -> Optional[str]:
    """`{"error": "..."}`, `{"error": {"message": "..."}}` and `{"message": "..."}`."""
    error = body.get("error")
    if isinstance(error, str):
        return error
    if isinstance(error, dict) and isinstance(error.get("message"), str):
        return str(error["message"])
    message = body.get("message")
    return message if isinstance(message, str) else None
