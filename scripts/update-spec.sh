#!/usr/bin/env bash
#
# Pull the current API description and regenerate everything.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
url="${1:-https://snaga.ai/openapi.json}"

echo "fetching $url"
curl -fsSL "$url" | python3 -m json.tool --no-ensure-ascii > "$root/spec/openapi.json"

node "$root/generator/src/index.ts"
echo "regenerated; run 'make test' to verify"
