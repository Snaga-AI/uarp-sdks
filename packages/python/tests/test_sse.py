"""The event-stream parser, against the fixture every SDK of this family replays."""

from __future__ import annotations

import json
import pathlib

from uarp_sdk._sse import Parser

FIXTURES = pathlib.Path(__file__).resolve().parents[3] / "contract" / "sse-fixtures"


def parse_all(*chunks: bytes) -> tuple:
    parser = Parser()
    events = [event for chunk in chunks for event in parser.push(chunk)]
    trailing = parser.finish()
    if trailing is not None:
        events.append(trailing)
    return events, parser


def test_decodes_the_shared_mixed_format_fixture_to_the_locked_expected_output() -> None:
    #  Kotlin locks mixed.expected.json; every port replays the same bytes.
    events, parser = parse_all((FIXTURES / "mixed.txt").read_bytes())
    expected = json.loads((FIXTURES / "mixed.expected.json").read_text())
    assert [{"id": e.id, "event": e.event, "data": e.data, "retry": e.retry} for e in events] == expected
    assert parser.done


def test_the_fixture_survives_being_cut_into_single_bytes() -> None:
    raw = (FIXTURES / "mixed.txt").read_bytes()
    whole, _ = parse_all(raw)
    split, _ = parse_all(*[raw[index : index + 1] for index in range(len(raw))])
    assert split == whole


def test_survives_chunk_boundaries_crlf_and_a_split_character() -> None:
    word = "агент".encode()
    events, _ = parse_all(b"event: par", b"tial\r\ndata: " + word[:3], word[3:] + b"\r\n\r\n")
    assert [(event.event, event.data) for event in events] == [("partial", "агент")]


def test_joins_multi_line_data_and_defaults_the_name() -> None:
    events, _ = parse_all(b"data: one\ndata: two\n\n")
    assert [(event.event, event.data) for event in events] == [("message", "one\ntwo")]


def test_an_id_or_retry_only_frame_emits_nothing_and_the_id_does_not_leak() -> None:
    events, _ = parse_all(b"id: 99\nretry: 500\n\ndata: later\n\n")
    assert [(event.id, event.data) for event in events] == [(None, "later")]


def test_the_retry_field_is_kept() -> None:
    events, _ = parse_all(b"retry: 1500\ndata: x\n\n")
    assert events[0].retry == 1500


def test_done_ends_the_stream_and_nothing_after_it_counts() -> None:
    events, parser = parse_all(b"data: hi\n\ndata: [DONE]\n\ndata: after\n\n")
    assert [event.data for event in events] == ["hi"]
    assert parser.done


def test_a_done_frame_with_only_an_id_emits_nothing() -> None:
    events, parser = parse_all(b"id: 7\ndata: [DONE]\n\n")
    assert events == []
    assert parser.done


def test_a_type_member_names_the_event_even_with_escaped_quotes_around() -> None:
    events, _ = parse_all(b'data: {"msg":"she said \\"type\\"","type":"x"}\n\n')
    assert events[0].event == "x"
