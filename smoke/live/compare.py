#!/usr/bin/env python3
"""Check that every SDK read the live server the same way.

The first name on the command line is the reference. `language` is expected to
differ; everything else must match, because every reported value describes what
the server said, not what the runner did. Called by smoke/live/run.sh.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "out"

#  Reported by every runner but never comparable between them.
IGNORED = {"language"}

#  The sentinel every runner uses in place of a value it could not decode.
DECODE_FAILED = "decode failed"


def load(name: str) -> dict:
    return json.loads((OUT / f"{name}.json").read_text())


def compare(reference_name: str, reference: dict, name: str, values: dict) -> list[str]:
    problems = []
    for key in sorted(set(reference) | set(values)):
        if key in IGNORED:
            continue
        expected = reference.get(key, "<missing>")
        actual = values.get(key, "<missing>")
        if expected != actual:
            problems.append(f"{key}: {name} read {actual!r}, {reference_name} read {expected!r}")
    return problems


def main() -> int:
    names = sys.argv[1:]
    if len(names) < 2:
        print("need at least two runners", file=sys.stderr)
        return 1

    reference_name, *others = names
    reference = load(reference_name)

    interesting = {k: v for k, v in reference.items() if k not in IGNORED}
    print(f"{reference_name}: {json.dumps(interesting, sort_keys=True)} (reference)")

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
        #  Two very different causes look the same here, and saying so saves
        #  whoever reads this from chasing the wrong one.
        if any(DECODE_FAILED in json.dumps(load(name)) for name in names):
            print(
                f"\nAt least one SDK answered {DECODE_FAILED!r}. The five sent the same"
                "\nrequest, so the usual cause is a response that does not match its"
                "\nschema: the strict decoders — Rust, Swift, Kotlin — refuse it while"
                "\nTypeScript and Ada let it through. Look for the field in"
                "\nsmoke/out/BACKEND-REPORT.md before suspecting the SDK."
            )
        else:
            print(
                "\nThe SDKs disagree about what the live server said, and none of them"
                "\nfailed to decode it. They all sent the same request, so this is a"
                "\nper-language decoding bug."
            )
        return 1

    print(f"\nall {len(names)} SDKs read the live server identically")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
