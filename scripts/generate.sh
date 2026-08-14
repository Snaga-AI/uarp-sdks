#!/usr/bin/env bash
#
# Regenerate the SDKs from spec/openapi.json.
#
#   scripts/generate.sh                 every target
#   scripts/generate.sh rust swift      a subset
#   scripts/generate.sh --stats         report what the spec contains
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$root/generator/src/index.ts" "$@"
