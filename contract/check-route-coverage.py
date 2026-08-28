#!/usr/bin/env python3
"""
Does the BUILT TypeScript SDK still reach every route the platform serves?

Why this exists, and why it does not compare version strings
------------------------------------------------------------
Measured 2026-08-27: the live API served 641 operations, `docs/openapi.json`
served the same 641, and `apps/sdk/spec/openapi.json` — the file the generator
turns into all five SDKs — carried 559. Eighty-two operations short, with zero
extras. Every one of those five SDKs was therefore blind in exactly the same
places, which is why `contract/run.sh` could not see it: that gate compares SDK
traces to EACH OTHER, so identical blindness reads as agreement.

Both files declared `version: 0.2.0`, so any check of the form "do the versions
match?" reports fresh forever. Routes are the only honest unit.

Why the BUILT SDK and not the spec
----------------------------------
`gen_manifest.py` in the Ada client builds its operation table from the
TypeScript SDK's `.d.ts` declarations, not from openapi — openapi only enriches
operations the SDK already exposes. So the chain is:

    spec/openapi.json -> generator -> five SDKs -> npm uarp-sdk
      -> node_modules -> gen_manifest.py -> Ada operation table

Refreshing the spec alone changes nothing downstream until the SDK is rebuilt
and published. A gate on the spec would go green while the last link stayed
stale — the exact gap that let this live. So this compares the artefact that is
actually consumed.

Usage
-----
    contract/check-route-coverage.py [--openapi PATH] [--sdk-dist PATH]
    contract/check-route-coverage.py --url https://api.snaga.ai/openapi.json --token "$SNAGA_TOKEN"

Exit 1 when the SDK cannot reach a route the platform serves.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_SPEC = REPO / "spec" / "openapi.json"
DEFAULT_DIST = REPO / "packages" / "typescript" / "dist" / "generated" / "resources"

VERBS = ("get", "post", "put", "patch", "delete")


def spec_operations(doc: dict) -> set[tuple[str, str]]:
    return {
        (verb.upper(), path)
        for path, item in (doc.get("paths") or {}).items()
        for verb in item
        if verb.lower() in VERBS
    }


def sdk_operations(dist: pathlib.Path) -> set[tuple[str, str]]:
    """Routes the built client can actually issue.

    Read from the emitted JS rather than the .d.ts: types describe the shape of
    a call, the JS carries the method and path it will really send. A type that
    exists for a route the client never requests is not coverage.
    """
    found: set[tuple[str, str]] = set()
    # The generator emits a request object, not a positional call:
    #     return this._client.request({
    #         method: 'GET',
    #         path: '/api/v1/analytics/agents',
    # so the pair is matched across the two adjacent properties.
    pat = re.compile(
        r"method:\s*['\"](GET|POST|PUT|PATCH|DELETE)['\"]\s*,\s*"
        r"path:\s*[`'\"]([^`'\"]+)[`'\"]",
        re.MULTILINE,
    )
    # rglob, not glob. `tsc` mirrors the source layout, so exactly ONE .js file
    # lands at the top of dist/ — index.js, which only re-exports — and all 60
    # others sit under dist/generated/resources/ and dist/core/. A non-recursive
    # glob therefore reads no routes at all and the gate reports every single
    # operation unreachable: `sdk ops: 0, unreachable: 641` against a client that
    # in fact reaches all 641. A gate that is red no matter what is worse than no
    # gate, because the first person to see it learns to ignore it.
    for js in sorted(dist.rglob("*.js")):
        for verb, path in pat.findall(js.read_text(encoding="utf-8")):
            # Template holes (`${agentId}`) stand in for the spec's {agentId}.
            norm = re.sub(r"\$\{[^}]+\}", "{param}", path)
            found.add((verb.upper(), norm))
    return found


def normalise(op: tuple[str, str]) -> tuple[str, str]:
    """Compare by shape, not by parameter NAME: the SDK emits `${agentId}` and
    the spec writes `{agentId}`, but a rename on either side is not a coverage
    change and must not read as one."""
    verb, path = op
    return verb, re.sub(r"\{[^}]+\}", "{}", path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--openapi", type=pathlib.Path, default=DEFAULT_SPEC)
    ap.add_argument("--sdk-dist", type=pathlib.Path, default=DEFAULT_DIST)
    ap.add_argument("--url", help="fetch the spec from a live API instead of a file")
    ap.add_argument("--token", help="bearer token for --url")
    ap.add_argument("--max-missing", type=int, default=0)
    args = ap.parse_args()

    if args.url:
        req = urllib.request.Request(args.url)
        if args.token:
            req.add_header("Authorization", f"Bearer {args.token}")
        doc = json.loads(urllib.request.urlopen(req, timeout=60).read())
        source = args.url
    else:
        if not args.openapi.exists():
            print(f"openapi not found: {args.openapi}", file=sys.stderr)
            return 2
        doc = json.loads(args.openapi.read_text(encoding="utf-8"))
        source = str(args.openapi)

    if not args.sdk_dist.exists():
        print(
            f"built SDK not found at {args.sdk_dist} — build the TypeScript "
            "package first; an unbuilt SDK is not evidence of coverage.",
            file=sys.stderr,
        )
        return 2

    platform = {normalise(o) for o in spec_operations(doc)}
    sdk = {normalise(o) for o in sdk_operations(args.sdk_dist)}
    missing = sorted(platform - sdk)

    print(f"spec source : {source}")
    print(f"spec version: {(doc.get('info') or {}).get('version')} "
          "(informational only — this gate does not compare versions)")
    print(f"platform ops: {len(platform)}")
    print(f"sdk ops     : {len(sdk)}")
    print(f"unreachable : {len(missing)}")

    if missing:
        print("\nRoutes the platform serves that the built SDK cannot reach:")
        for verb, path in missing[:40]:
            print(f"  {verb:<6} {path}")
        if len(missing) > 40:
            print(f"  … and {len(missing) - 40} more")

    if len(missing) > args.max_missing:
        print(
            "\nFAIL: regenerate the SDKs from a current spec and rebuild.\n"
            "Refreshing spec/openapi.json alone is NOT enough — the Ada manifest "
            "and any other downstream table are built from the SDK, not the spec.",
            file=sys.stderr,
        )
        return 1
    print("\nOK: the built SDK reaches every route the platform serves.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
