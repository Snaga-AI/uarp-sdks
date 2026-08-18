#!/usr/bin/env bash
#
# Pull the current API description and regenerate everything.
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
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
url="${1:-https://api.snaga.ai/api/v1/openapi.json}"
current="$root/spec/openapi.json"
fetched="$(mktemp)"
trap 'rm -f "$fetched"' EXIT

echo "fetching $url"
curl -fsSL "$url" | python3 -m json.tool --no-ensure-ascii > "$fetched"

if [[ -f "$current" ]]; then
    python3 - "$current" "$fetched" "$url" <<'PY'
import json, sys

def shape(path):
    with open(path) as f:
        d = json.load(f)
    return len(d.get("paths", {})), len(d.get("components", {}).get("schemas", {}))

have_paths, have_schemas = shape(sys.argv[1])
got_paths, got_schemas = shape(sys.argv[2])

if got_paths < have_paths or got_schemas < have_schemas:
    sys.exit(
        f"refusing to regenerate from a document smaller than the one vendored here:\n"
        f"  vendored: {have_paths} paths, {have_schemas} schemas\n"
        f"  fetched:  {got_paths} paths, {got_schemas} schemas\n"
        f"Fetched from: {sys.argv[3]}\n"
        f"A deployed document can lag the API. Pass the right url as the first\n"
        f"argument if this shrink is deliberate."
    )
print(f"document check: {got_paths} paths, {got_schemas} schemas (vendored had {have_paths}/{have_schemas})")
PY
fi

cp "$fetched" "$current"
node "$root/generator/src/index.ts"
echo "regenerated; run 'make test' to verify"
