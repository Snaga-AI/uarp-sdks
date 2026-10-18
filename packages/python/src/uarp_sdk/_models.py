"""The base classes the generated models are built on, and the codec between them and JSON.

Decoding is strict in the way the Rust, Swift and Kotlin SDKs are strict: a
field the document marks required has to be there, a string has to be a
string, and an integer is not a float. That is the point of a typed SDK. A
model that quietly accepted anything would decode every body the platform
sends, including the ones that differ from the document, and the difference
would surface three calls later as an attribute that is `None` for no reason
anyone can see.

Two things are deliberately lenient, because they are how the API grows:

* a key the model does not declare is ignored (or kept, on the models the
  document declares open), and
* an enum value this SDK has never seen decodes to a member of the enum that
  carries the value, instead of failing the whole body.
"""

from __future__ import annotations

import dataclasses
import enum
import sys
import threading
import types
import typing
from typing import Any, Callable, Dict, List, Mapping, Union

from ._errors import DecodeError, EncodeError
from ._files import FilePart

#: Any JSON value: what a field the document leaves untyped decodes to.
JsonValue = Any
#: A JSON object whose members the document does not describe.
JsonObject = Dict[str, Any]
#: Bytes for a file part of a multipart body: raw `bytes`, or a `FilePart`
#: that also carries a filename and a content type.
FileInput = Union[FilePart, bytes]

#: The attribute that holds the members of an open model the document does not name.
ADDITIONAL = "additional_properties"


class UarpEnum(str, enum.Enum):
    """Base class of every generated enum.

    A member compares equal to its wire value (`RunStatus.QUEUED == "queued"`).
    A value the API added after this SDK was generated still decodes: it becomes
    an instance of the enum that is not one of its declared members, carries the
    value as sent, and reports `is_known` as false.
    """

    @classmethod
    def _missing_(cls, value: object) -> Any:
        if not isinstance(value, str):
            return None
        member = str.__new__(cls, value)
        member._name_ = value
        member._value_ = value
        return member

    @property
    def is_known(self) -> bool:
        """Whether this value is one the SDK was generated with."""
        return self._name_ in type(self).__members__

    def __str__(self) -> str:
        return str(self.value)

    def __format__(self, spec: str) -> str:
        return format(str(self.value), spec)

    def __repr__(self) -> str:
        if self.is_known:
            return f"<{type(self).__name__}.{self._name_}: {self.value!r}>"
        return f"<{type(self).__name__} (unknown): {self.value!r}>"


class Model:
    """Base class of every generated model (a keyword-only dataclass)."""

    @classmethod
    def from_dict(cls, data: Any) -> Any:
        """Decode a JSON value (as `json.loads` returns it) into this model."""
        return decode(cls, data)

    def to_dict(self) -> Dict[str, Any]:
        """The JSON object this model is sent as."""
        return typing.cast(Dict[str, Any], encode(self))


# ------------------------------------------------------------------ decoding

Decoder = Callable[[Any, str], Any]

_decoders: Dict[Any, Decoder] = {}
_pending: Dict[Any, Decoder] = {}
_building = threading.RLock()


def decode(type_: Any, data: Any) -> Any:
    """Decode `data` (already parsed JSON) as `type_`, or raise `DecodeError`."""
    return _decoder(type_)(data, "$")


def _decoder(type_: Any) -> Decoder:
    try:
        found = _decoders.get(type_)
    except TypeError:  # an unhashable annotation; build it every time
        return _build(type_)
    if found is not None:
        return found
    #  Decoders are built under a lock and published only when the outermost
    #  one is finished, so another thread never sees one that refers to a
    #  placeholder still waiting for its decoder.
    with _building:
        found = _decoders.get(type_) or _pending.get(type_)
        if found is not None:
            return found
        outermost = not _pending
        #  A placeholder first, so a model that refers to itself (a tree, a
        #  thread of replies) resolves to the decoder being built.
        cell: List[Decoder] = []
        _pending[type_] = lambda value, path: cell[0](value, path)
        try:
            built = _build(type_)
        except BaseException:
            if outermost:
                _pending.clear()
            else:
                del _pending[type_]
            raise
        cell.append(built)
        _pending[type_] = built
        if outermost:
            _decoders.update(_pending)
            _pending.clear()
        return built


def _describe(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "a boolean"
    if isinstance(value, (int, float)):
        return "a number"
    if isinstance(value, str):
        return "a string"
    if isinstance(value, list):
        return "an array"
    if isinstance(value, dict):
        return "an object"
    return type(value).__name__


def _fail(path: str, expected: str, value: Any) -> DecodeError:
    return DecodeError(f"{path}: expected {expected}, got {_describe(value)}", path=path)


def _identity(value: Any, path: str) -> Any:
    return value


def _string(value: Any, path: str) -> str:
    if isinstance(value, str):
        return value
    raise _fail(path, "a string", value)


def _integer(value: Any, path: str) -> int:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    raise _fail(path, "an integer", value)


def _number(value: Any, path: str) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    raise _fail(path, "a number", value)


def _boolean(value: Any, path: str) -> bool:
    if isinstance(value, bool):
        return value
    raise _fail(path, "a boolean", value)


def _object(value: Any, path: str) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    raise _fail(path, "an object", value)


_SCALARS: Dict[Any, Decoder] = {
    str: _string,
    int: _integer,
    float: _number,
    bool: _boolean,
    Any: _identity,
    object: _identity,
}


def _build(type_: Any) -> Decoder:
    scalar = _SCALARS.get(type_)
    if scalar is not None:
        return scalar

    origin = typing.get_origin(type_)
    if origin is Union or (sys.version_info >= (3, 10) and origin is types.UnionType):
        arguments = [arg for arg in typing.get_args(type_) if arg is not type(None)]
        nullable = len(arguments) < len(typing.get_args(type_))
        if len(arguments) == 1:
            inner = _decoder(arguments[0])
            if not nullable:
                return inner

            def optional(value: Any, path: str) -> Any:
                return None if value is None else inner(value, path)

            return optional
        if all(_is_file(arg) for arg in arguments):
            return _file_decoder
        #  The generator only writes `X | None`; any other union is raw JSON.
        return _identity

    if origin in (list, List):
        (item_type,) = typing.get_args(type_) or (Any,)
        item = _decoder(item_type)

        def array(value: Any, path: str) -> List[Any]:
            if not isinstance(value, list):
                raise _fail(path, "an array", value)
            return [item(entry, f"{path}[{index}]") for index, entry in enumerate(value)]

        return array

    if origin in (dict, Dict):
        parameters = typing.get_args(type_)
        values = _decoder(parameters[1]) if len(parameters) == 2 else _identity
        if values is _identity:
            return _object

        def mapping(value: Any, path: str) -> Dict[str, Any]:
            if not isinstance(value, dict):
                raise _fail(path, "an object", value)
            return {key: values(entry, f"{path}.{key}") for key, entry in value.items()}

        return mapping

    if type_ in (dict, Dict):
        return _object
    if type_ in (list, List):
        return _decoder(List[Any])

    if isinstance(type_, type) and issubclass(type_, UarpEnum):
        enum_type = type_

        def member(value: Any, path: str) -> Any:
            if not isinstance(value, str):
                raise _fail(path, f"a {enum_type.__name__} value", value)
            return enum_type(value)

        return member

    if isinstance(type_, type) and dataclasses.is_dataclass(type_):
        return _model_decoder(type_)

    if _is_file(type_):
        return _file_decoder

    raise TypeError(f"no decoder for {type_!r}")


def _is_file(type_: Any) -> bool:
    return type_ is bytes or type_ is FilePart


def _file_decoder(value: Any, path: str) -> Any:
    raise DecodeError(f"{path}: a file part is sent, never received", path=path)


class _Field(typing.NamedTuple):
    attribute: str
    wire: str
    decoder: Decoder
    #  A missing key is acceptable: the property is optional or nullable.
    may_be_absent: bool
    default: Any


def _model_decoder(cls: type) -> Decoder:
    hints = typing.get_type_hints(cls)
    fields: List[_Field] = []
    open_model = False
    for field in dataclasses.fields(cls):
        if field.name == ADDITIONAL and field.metadata.get("additional"):
            open_model = True
            continue
        annotation = hints[field.name]
        has_default = field.default is not dataclasses.MISSING or field.default_factory is not dataclasses.MISSING
        default = field.default if field.default is not dataclasses.MISSING else None
        nullable = _accepts_none(annotation)
        fields.append(
            _Field(
                attribute=field.name,
                wire=field.metadata.get("wire", field.name),
                decoder=_decoder(annotation),
                may_be_absent=has_default or nullable,
                default=default,
            )
        )
    declared = {field.wire for field in fields}
    name = cls.__name__

    def model(value: Any, path: str) -> Any:
        if not isinstance(value, dict):
            raise _fail(path, f"a {name} object", value)
        arguments: Dict[str, Any] = {}
        for field in fields:
            if field.wire in value:
                arguments[field.attribute] = field.decoder(value[field.wire], f"{path}.{field.wire}")
            elif field.may_be_absent:
                arguments[field.attribute] = field.default
            else:
                raise DecodeError(f"{path}: {name} requires `{field.wire}`, which is absent", path=path)
        if open_model:
            arguments[ADDITIONAL] = {key: entry for key, entry in value.items() if key not in declared}
        return cls(**arguments)

    return model


def _accepts_none(annotation: Any) -> bool:
    if annotation is Any:
        return True
    origin = typing.get_origin(annotation)
    if origin is Union or (sys.version_info >= (3, 10) and origin is types.UnionType):
        return type(None) in typing.get_args(annotation)
    return False


# ------------------------------------------------------------------ encoding

_JSON_SCALARS = (str, int, float, bool)


def encode(value: Any, *, keep_files: bool = False) -> Any:
    """The JSON value a model, an enum or a plain structure is sent as.

    An optional property left at `None` is not sent at all; a required one that
    is nullable is sent as `null`. That is the rule every SDK of this family
    applies. To send an explicit `null` for an optional property, pass the body
    as a plain `dict`, which goes on the wire as it is.

    `keep_files` leaves `bytes` and `FilePart` values in place, for a multipart
    body; anywhere else a file in a JSON body is an error.
    """
    if value is None:
        return None
    if isinstance(value, UarpEnum):
        return value.value
    if isinstance(value, _JSON_SCALARS):
        return value
    if isinstance(value, Model) and dataclasses.is_dataclass(value):
        out: Dict[str, Any] = {}
        extra: Mapping[str, Any] = {}
        for field in dataclasses.fields(value):
            current = getattr(value, field.name)
            if field.name == ADDITIONAL and field.metadata.get("additional"):
                extra = current or {}
                continue
            optional = field.default is not dataclasses.MISSING or field.default_factory is not dataclasses.MISSING
            if current is None and optional:
                continue
            out[field.metadata.get("wire", field.name)] = encode(current, keep_files=keep_files)
        for key, entry in extra.items():
            out.setdefault(key, encode(entry, keep_files=keep_files))
        return out
    if isinstance(value, Mapping):
        return {str(key): encode(entry, keep_files=keep_files) for key, entry in value.items()}
    if isinstance(value, (list, tuple)):
        return [encode(entry, keep_files=keep_files) for entry in value]
    if isinstance(value, (bytes, bytearray, memoryview, FilePart)):
        if keep_files:
            return value
        raise EncodeError("a file can only be sent as a part of a multipart body")
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return encode(dataclasses.asdict(value), keep_files=keep_files)
    raise EncodeError(f"cannot send a {type(value).__name__} as JSON")
