#!/usr/bin/env python3
"""Compare the traces the contract runners produced.

The first trace named on the command line is the reference; every other one has
to match it request for request. Called by contract/run.sh.
"""
import json
import sys
from pathlib import Path

TRACES = Path(__file__).parent / "traces"


def load(name: str):
    return json.loads((TRACES / f"{name}.json").read_text())


def describe(request) -> str:
    return f"{request['method']} {request['path']}"


def compare(reference_name: str, reference, name: str, trace) -> list[str]:
    problems = []
    if len(reference) != len(trace):
        problems.append(
            f"made {len(trace)} requests, {reference_name} made {len(reference)}"
        )

    for index, (expected, actual) in enumerate(zip(reference, trace), start=1):
        for field in ("method", "path", "raw_query", "query", "headers", "body"):
            if expected.get(field) == actual.get(field):
                continue
            problems.append(
                f"request {index} ({describe(expected)}) differs in {field}\n"
                f"      {reference_name}: {json.dumps(expected.get(field), sort_keys=True)}\n"
                f"      {name}: {json.dumps(actual.get(field), sort_keys=True)}"
            )
    return problems


def main() -> int:
    names = sys.argv[1:]
    if len(names) < 2:
        print("need at least two traces", file=sys.stderr)
        return 1

    reference_name, *others = names
    reference = load(reference_name)

    print(f"{reference_name}: {len(reference)} requests (reference)")
    failed = False

    for name in others:
        problems = compare(reference_name, reference, name, load(name))
        if not problems:
            print(f"{name}: identical")
            continue
        failed = True
        print(f"{name}: {len(problems)} difference(s)")
        for problem in problems:
            print(f"  - {problem}")

    if failed:
        print(
            "\nThe SDKs disagree about what to put on the wire. Either fix the odd"
            "\none out, or record the difference in contract/SCENARIOS.md with a"
            "\nreason.",
        )
        return 1

    print(f"\nall {len(names)} SDKs agree on all {len(reference)} requests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
