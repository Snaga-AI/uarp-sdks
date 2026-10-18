"""The codec between JSON and the generated models."""

from __future__ import annotations

import dataclasses
from typing import Any, Dict, List, Optional

import pytest

from uarp_sdk import DecodeError, EncodeError, FilePart, Model, UarpEnum, decode, encode
from uarp_sdk.models import (
    AdminGetReconciliationResponseReconciliation,
    CreateAgentRequest,
    ListAgentsResponse,
    RunStatus,
)


def test_an_optional_property_left_unset_is_not_sent() -> None:
    assert CreateAgentRequest(name="demo").to_dict() == {"name": "demo"}


def test_a_required_nullable_property_is_sent_as_null() -> None:
    page = ListAgentsResponse.from_dict({"items": [], "cursor": None, "has_more": False})
    assert page.cursor is None
    assert page.to_dict() == {"items": [], "cursor": None, "has_more": False}


def test_a_required_nullable_property_may_be_absent_on_the_wire() -> None:
    #  The Rust SDK accepts this too (`Option` with `default`): absent and
    #  null both read as "not set".
    assert ListAgentsResponse.from_dict({"items": [], "has_more": False}).cursor is None


def test_a_required_property_cannot_be_left_out_of_a_body() -> None:
    with pytest.raises(TypeError):
        CreateAgentRequest()  # type: ignore[call-arg]


def test_an_open_model_keeps_what_the_document_does_not_name() -> None:
    model = AdminGetReconciliationResponseReconciliation.from_dict({"period": "2026-10", "stripe": 3})
    assert model.period == "2026-10"
    assert model.additional_properties == {"stripe": 3}
    assert model.to_dict() == {"period": "2026-10", "stripe": 3}


def test_a_closed_model_ignores_what_the_document_does_not_name() -> None:
    #  An undeclared key is how the API grows; it must not fail the body.
    request = CreateAgentRequest.from_dict({"name": "demo", "brand_new": 1})
    assert request.name == "demo"


def test_a_wire_name_that_is_a_keyword_round_trips() -> None:
    import uarp_sdk.generated.models as models

    renamed = [
        cls
        for cls in vars(models).values()
        if isinstance(cls, type)
        and dataclasses.is_dataclass(cls)
        and any(field.metadata.get("wire") == "from" for field in dataclasses.fields(cls))
    ]
    assert renamed, "the document has a `from` property"
    cls = renamed[0]
    hints = {field.name: field for field in dataclasses.fields(cls)}
    assert "from_" in hints


def test_an_unknown_enum_value_decodes_and_says_so() -> None:
    status = decode(RunStatus, "brand_new_status")
    assert isinstance(status, RunStatus)
    assert status == "brand_new_status"
    assert str(status) == "brand_new_status"
    assert f"{status}" == "brand_new_status"
    assert not status.is_known
    assert encode(status) == "brand_new_status"


def test_a_known_enum_value_is_the_member() -> None:
    assert decode(RunStatus, "queued") is RunStatus.QUEUED
    assert RunStatus.QUEUED.is_known
    assert RunStatus.QUEUED == "queued"


def test_an_enum_value_that_is_not_a_string_fails() -> None:
    with pytest.raises(DecodeError, match=r"\$: expected a RunStatus value, got a number"):
        decode(RunStatus, 3)


def test_an_integer_is_not_a_float_and_a_boolean_is_not_an_integer() -> None:
    assert decode(float, 3) == 3.0
    assert isinstance(decode(float, 3), float)
    with pytest.raises(DecodeError):
        decode(int, 3.0)
    with pytest.raises(DecodeError):
        decode(int, True)
    with pytest.raises(DecodeError):
        decode(float, False)


def test_a_path_names_the_failing_member() -> None:
    with pytest.raises(DecodeError) as caught:
        decode(List[Dict[str, int]], [{"a": 1}, {"b": "two"}])
    assert caught.value.path == "$[1].b"


@dataclasses.dataclass(kw_only=True)
class Node(Model):
    name: str
    children: Optional[List["Node"]] = None


def test_a_model_that_refers_to_itself_decodes() -> None:
    tree = decode(Node, {"name": "a", "children": [{"name": "b", "children": [{"name": "c"}]}]})
    assert tree.children[0].children[0].name == "c"


def test_a_file_in_a_json_body_is_an_error() -> None:
    with pytest.raises(EncodeError):
        encode({"artifact": b"\x00"})
    assert encode({"artifact": FilePart(data=b"\x00")}, keep_files=True)["artifact"].data == b"\x00"


class Colour(UarpEnum):
    RED = "red"


def test_an_enum_inside_a_structure_is_sent_as_its_value() -> None:
    assert encode({"colours": [Colour.RED, Colour("mauve")]}) == {"colours": ["red", "mauve"]}


def test_any_keeps_the_json_as_it_is() -> None:
    value: Any = {"a": [1, None, {"b": True}]}
    assert decode(Any, value) is value


def test_decoders_built_on_many_threads_at_once_all_work() -> None:
    import threading

    import uarp_sdk._models as codec

    @dataclasses.dataclass(kw_only=True)
    class Thread(Model):
        title: str
        replies: Optional[List["Thread"]] = None

    globals()["Thread"] = Thread  # the forward reference resolves in this module
    barrier = threading.Barrier(16)
    failures: List[BaseException] = []

    def work() -> None:
        barrier.wait()
        try:
            decode(Thread, {"title": "a", "replies": [{"title": "b", "replies": []}]})
        except BaseException as error:  # noqa: BLE001
            failures.append(error)

    threads = [threading.Thread(target=work) for _ in range(16)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert failures == []
    assert Thread in codec._decoders and not codec._pending
