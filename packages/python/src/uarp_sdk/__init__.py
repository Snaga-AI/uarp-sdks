"""Python client for the UARP (Snaga) Universal Agent Runtime Platform API.

    from uarp_sdk import Client

    with Client() as client:  # reads UARP_API_KEY
        for agent in client.agents.list_all():
            print(agent.name)

Models live in `uarp_sdk.models`; errors derive from `UarpError`.
"""

from ._client import AsyncClient, Client
from ._errors import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    ConfigError,
    ConflictError,
    DecodeError,
    EncodeError,
    FieldError,
    GoneError,
    InternalServerError,
    NotFoundError,
    PayloadTooLargeError,
    PermissionDeniedError,
    Problem,
    RateLimitError,
    ServiceUnavailableError,
    UarpError,
    UnprocessableEntityError,
)
from ._files import FilePart
from ._models import FileInput, JsonObject, JsonValue, Model, UarpEnum, decode, encode
from ._sse import AsyncEventStream, Event, EventStream, StreamOptions, StreamState
from ._transport import RequestOptions
from .generated.meta import DEFAULT_BASE_URL, SCOPES, SDK_VERSION, SPEC_VERSION

__version__ = SDK_VERSION

__all__ = [
    "DEFAULT_BASE_URL",
    "SCOPES",
    "SDK_VERSION",
    "SPEC_VERSION",
    "APIConnectionError",
    "APIError",
    "APITimeoutError",
    "AsyncClient",
    "AsyncEventStream",
    "AuthenticationError",
    "BadRequestError",
    "Client",
    "ConfigError",
    "ConflictError",
    "DecodeError",
    "EncodeError",
    "Event",
    "EventStream",
    "FieldError",
    "FileInput",
    "FilePart",
    "GoneError",
    "InternalServerError",
    "JsonObject",
    "JsonValue",
    "Model",
    "NotFoundError",
    "PayloadTooLargeError",
    "PermissionDeniedError",
    "Problem",
    "RateLimitError",
    "RequestOptions",
    "ServiceUnavailableError",
    "StreamOptions",
    "StreamState",
    "UarpEnum",
    "UarpError",
    "UnprocessableEntityError",
    "decode",
    "encode",
]
