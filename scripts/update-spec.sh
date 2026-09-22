#!/usr/bin/env bash
#
# Pull the current API description and regenerate everything.
#
#   scripts/update-spec.sh
#   scripts/update-spec.sh <url>
#   scripts/update-spec.sh --allow-shrink "why the document is smaller"
#
# The url is the API's OWN document, not the copy the marketing site serves.
# They are usually identical and were the same byte-for-byte when this changed —
# but `snaga.ai/openapi.json` is a file committed in the builder repository and
# deployed separately, so it lags the API by however long it takes someone to
# notice. On 2026-08-18 it lagged by hours across two API deploys, and
# regenerating against it would have produced the PREVIOUS models from a run
# that was green in every respect: the generator would have faithfully rendered
# a document that faithfully described last week's API.
#
# That is the failure worth guarding against, because nothing about it looks
# wrong. The guard below is not a substitute for the right source, it is the
# second line: if the fetched document describes fewer paths or schemas than the
# one already vendored here, that is a regression, and it stops.
#
# A shrink can also be correct — a surface is withdrawn and the document says so.
# `--allow-shrink "<reason>"` is that case, and it NAMES what leaves rather than
# only counting it: the removed paths, operations and schemas are printed, and
# the reason is required. Until 2026-09-21 this escape hatch did not exist and
# the refusal said to "pass the right url", which cannot work — the guard weighs
# whatever is fetched, so the only url that passes is a document stale enough to
# still carry the withdrawn surface. That advice pointed at the one action that
# would have re-vendored last week's API.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
url="https://api.snaga.ai/api/v1/openapi.json"
allow_shrink=""
shrink_allowed=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --allow-shrink)
            shrink_allowed=1
            allow_shrink="${2:-}"
            shift 2 || shift
            ;;
        --allow-shrink=*)
            shrink_allowed=1
            allow_shrink="${1#--allow-shrink=}"
            shift
            ;;
        -*)
            echo "unknown option: $1" >&2
            exit 2
            ;;
        *)
            url="$1"
            shift
            ;;
    esac
done

if [[ "$shrink_allowed" == 1 && -z "${allow_shrink// /}" ]]; then
    echo "--allow-shrink needs a reason: what was withdrawn, and where that was decided." >&2
    exit 2
fi

current="$root/spec/openapi.json"
fetched="$(mktemp)"
trap 'rm -f "$fetched"' EXIT

echo "fetching $url"
curl -fsSL "$url" | python3 -m json.tool --no-ensure-ascii > "$fetched"

if [[ -f "$current" ]]; then
    python3 - "$current" "$fetched" "$url" "$shrink_allowed" "$allow_shrink" <<'PY'
import json, sys

def load(path):
    with open(path) as f:
        return json.load(f)

def ops(d):
    verbs = ("get", "post", "put", "patch", "delete", "head", "options")
    return {(p, m) for p, item in d.get("paths", {}).items() for m in item if m in verbs}

have, got = load(sys.argv[1]), load(sys.argv[2])
url, allowed, reason = sys.argv[3], sys.argv[4] == "1", sys.argv[5]

have_paths, got_paths = set(have.get("paths", {})), set(got.get("paths", {}))
have_schemas = set(have.get("components", {}).get("schemas", {}))
got_schemas = set(got.get("components", {}).get("schemas", {}))

print(
    f"document check: {len(got_paths)} paths, {len(got_schemas)} schemas "
    f"(vendored had {len(have_paths)}/{len(have_schemas)})"
)

if len(got_paths) >= len(have_paths) and len(got_schemas) >= len(have_schemas):
    sys.exit(0)

lost_paths = sorted(have_paths - got_paths)
lost_ops = sorted(ops(have) - ops(got))
lost_schemas = sorted(have_schemas - got_schemas)

def report(out):
    for label, items in (
        ("paths", lost_paths),
        ("operations", [f"{m.upper()} {p}" for p, m in lost_ops]),
        ("schemas", lost_schemas),
    ):
        print(f"  {len(items)} {label} leave the copy:", file=out)
        for item in items:
            print(f"    - {item}", file=out)

if allowed:
    print("shrink allowed:", reason)
    report(sys.stdout)
    sys.exit(0)

print(
    "refusing to regenerate from a document smaller than the one vendored here:\n"
    f"  vendored: {len(have_paths)} paths, {len(have_schemas)} schemas\n"
    f"  fetched:  {len(got_paths)} paths, {len(got_schemas)} schemas\n"
    f"  fetched from: {url}",
    file=sys.stderr,
)
report(sys.stderr)
print(
    "\nA deployed document can lag the API, and a lagging document is the usual\n"
    "cause of a shrink. Check the source first.\n"
    "If the surface above was genuinely withdrawn, say so:\n"
    '  scripts/update-spec.sh --allow-shrink "withdrawn in <where that was decided>"',
    file=sys.stderr,
)
sys.exit(1)
PY
fi

cp "$fetched" "$current"
node "$root/generator/src/index.ts"
echo "regenerated; run 'make test' to verify"
