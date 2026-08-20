#!/usr/bin/env bash
#
# Is the vendored document still the one the platform serves?
#
# The generator reads `spec/openapi.json`, not the live API. `update-spec.sh`
# refreshes it, and it is run by hand. So a release can be cut from a fixed
# generator and a stale document, produce packages that omit every schema the
# platform added, and finish green — because the generator did its job
# faithfully against the wrong input.
#
# That is not hypothetical. 0.5.7 shipped exactly that way on 2026-08-19: the
# vendored copy was last refreshed for 0.5.6, ten merged document PRs were
# absent from the packages, and it was two consuming sessions — not this
# repository — that noticed, by reading a published tarball.
#
# Compared structurally, never byte-for-byte. The live document is serialised
# on demand, so key order and whitespace may differ without a difference in
# meaning; a guard that reds on formatting teaches people to ignore it, which
# is the failure mode of every check nobody trusts.
#
#   scripts/check-spec-freshness.sh          # report, exit 0 (CI)
#   scripts/check-spec-freshness.sh --strict # fail on divergence (release)
set -euo pipefail

strict=0
[[ "${1:-}" == "--strict" ]] && strict=1
url="${SPEC_URL:-https://api.snaga.ai/api/v1/openapi.json}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
vendored="$root/spec/openapi.json"

live="$(mktemp)"
trap 'rm -f "$live"' EXIT
if ! curl -fsSL --max-time 60 "$url" -o "$live"; then
    # Unreachable is not stale. Saying otherwise would block a release on a
    # network blip and train the next person to pass --no-verify.
    echo "spec-freshness: could not fetch ${url} — skipping (this is not a staleness signal)"
    exit 0
fi

summary() {
    python3 - "$1" <<'PY'
import hashlib, json, sys
d = json.load(open(sys.argv[1]))
paths = d.get("paths", {})
schemas = (d.get("components") or {}).get("schemas", {})
ops = sum(1 for p in paths.values() for m in p if m in
          ("get", "put", "post", "delete", "patch", "head", "options"))
# Names only: enough to catch an added or renamed schema, immune to how the
# document was serialised.
names = sorted(schemas) + sorted(paths)
digest = hashlib.sha256("\n".join(names).encode()).hexdigest()[:16]
print(f"{len(paths)} {len(schemas)} {ops} {digest}")
PY
}

read -r lp ls lo ld <<<"$(summary "$live")"
read -r vp vs vo vd <<<"$(summary "$vendored")"

printf 'spec-freshness: live     %s paths, %s schemas, %s operations (%s)\n' "$lp" "$ls" "$lo" "$ld"
printf 'spec-freshness: vendored %s paths, %s schemas, %s operations (%s)\n' "$vp" "$vs" "$vo" "$vd"

if [[ "$ld" == "$vd" ]]; then
    echo "spec-freshness: current"
    exit 0
fi

echo "spec-freshness: the vendored document is NOT what ${url} serves."
echo "spec-freshness: run scripts/update-spec.sh, review the regenerated packages, and commit."
if [[ $strict -eq 1 ]]; then
    echo "::error::Releasing from a stale spec produces packages that omit the platform's current schemas while looking complete. Refuse."
    exit 1
fi
echo "spec-freshness: not failing here — the platform moves on its own schedule, and a red CI on every upstream change is a red CI nobody reads."
