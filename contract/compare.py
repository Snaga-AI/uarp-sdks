#!/usr/bin/env python3
"""Compare what the contract runners sent and what they decoded.

The first name on the command line is the reference; every other SDK has to
match it request for request, and probe for probe. Differences listed in
known-differences.json are reported but do not fail the run.
Called by contract/run.sh.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
TRACES = HERE / "traces"


def load(name: str):
    return json.loads((TRACES / f"{name}.json").read_text())


def known_differences() -> list[dict]:
    path = HERE / "known-differences.json"
    return json.loads(path.read_text()) if path.exists() else []


def compare_probes(reference_name: str, probes: dict, allowed: list[dict]) -> tuple[list[str], list[str]]:
    """Compare decoded values. Returns (problems, accepted differences)."""
    reference = probes.get(reference_name)
    if reference is None:
        return ([f"{reference_name} reported no probes"], [])

    problems: list[str] = []
    accepted: list[str] = []

    for name, values in probes.items():
        if name == reference_name:
            continue
        for key in sorted(set(reference) | set(values)):
            expected = reference.get(key, "<missing>")
            actual = values.get(key, "<missing>")
            if expected == actual:
                continue
            excuse = next(
                (
                    entry
                    for entry in allowed
                    if entry["probe"] == key
                    and (name in entry["languages"] or reference_name in entry["languages"])
                ),
                None,
            )
            if excuse:
                #  One line per probe, not per pair: when the reference is the
                #  odd one out every other SDK reports the same difference.
                odd, odd_value = (
                    (reference_name, expected)
                    if reference_name in excuse["languages"]
                    else (name, actual)
                )
                others = actual if odd == reference_name else expected
                line = f"{key}: {odd} reads {odd_value}, the others {others} — {excuse['reason']}"
                if line not in accepted:
                    accepted.append(line)
            else:
                problems.append(f"{name} decoded {key} as {actual}, {reference_name} as {expected}")
    return (problems, accepted)


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

    probes_path = TRACES / "probes.json"
    if probes_path.exists():
        print()
        probe_problems, accepted = compare_probes(
            reference_name, json.loads(probes_path.read_text()), known_differences()
        )
        for note in accepted:
            print(f"known difference: {note}")
        if probe_problems:
            failed = True
            for problem in probe_problems:
                print(f"  - {problem}")
        elif accepted:
            print(
                f"decoding: all {len(names)} SDKs agree apart from"
                f" {len(accepted)} recorded difference"
                f"{'' if len(accepted) == 1 else 's'}"
            )
        else:
            print(f"decoding: all {len(names)} SDKs read the probe the same way")

    if failed:
        print(
            "\nThe SDKs disagree. Either fix the odd one out, or record the"
            "\ndifference in contract/known-differences.json with a reason.",
        )
        return 1

    print(f"\nall {len(names)} SDKs agree on all {len(reference)} requests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
