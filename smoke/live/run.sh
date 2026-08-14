#!/usr/bin/env bash
#
# Run the live scenario through every SDK whose toolchain is installed and
# check that they agree. See smoke/live/SCENARIO.md.
#
#   UARP_API_KEY=… smoke/live/run.sh
#   UARP_API_KEY=… smoke/live/run.sh rust ada
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out="$root/smoke/live/out"

if [[ -z "${UARP_API_KEY:-}" ]]; then
    echo "UARP_API_KEY is not set" >&2
    exit 1
fi
export UARP_BASE_URL="${UARP_BASE_URL:-https://api.snaga.ai}"

mkdir -p "$out"
rm -f "$out"/*.json

have() { command -v "$1" >/dev/null 2>&1; }

selected=("$@")
wanted() {
    [[ ${#selected[@]} -eq 0 ]] && return 0
    local name
    for name in "${selected[@]}"; do [[ "$name" == "$1" ]] && return 0; done
    return 1
}

ran=()
skipped=()

#  Each runner prints one JSON object; anything it writes to stderr is noise
#  from the toolchain, not part of the result.
capture() {
    local name="$1"
    shift
    echo "==> $name"
    if "$@" > "$out/$name.json" 2>"$out/$name.stderr"; then
        ran+=("$name")
    else
        echo "    failed; see $out/$name.stderr" >&2
        tail -3 "$out/$name.stderr" >&2 || true
        return 1
    fi
}

#  A toolchain that fails to build must not stop the other four from running:
#  the point of the check is the comparison, and a partial comparison still
#  finds disagreements.
if wanted typescript && have node; then
    (cd "$root/packages/typescript" && npm run --silent build >/dev/null) \
        && capture typescript node "$root/smoke/live/runners/typescript.ts" || true
else
    wanted typescript && skipped+=("typescript (node)")
fi

if wanted rust && have cargo; then
    (cd "$root/packages/rust" && cargo build --quiet --example live) \
        && capture rust "$root/packages/rust/target/debug/examples/live" || true
else
    wanted rust && skipped+=("rust (cargo)")
fi

if wanted swift && have swift; then
    (cd "$root/packages/swift" && swift build --quiet --product uarp-live) \
        && capture swift "$root/packages/swift/.build/debug/uarp-live" || true
else
    wanted swift && skipped+=("swift")
fi

if wanted kotlin && have java; then
    #  Gradle writes its own progress to stdout, so the runner's line is taken
    #  from the log rather than piped straight through.
    echo "==> kotlin"
    if (cd "$root/packages/kotlin" && ./gradlew :uarp-sdk:live --console=plain -q) \
        > "$out/kotlin.raw" 2>"$out/kotlin.stderr"; then
        grep -o '^{.*}$' "$out/kotlin.raw" | tail -1 > "$out/kotlin.json"
        ran+=("kotlin")
    else
        echo "    failed; see $out/kotlin.stderr" >&2
        tail -3 "$out/kotlin.stderr" >&2 || true
    fi
else
    wanted kotlin && skipped+=("kotlin (java)")
fi

if wanted ada && have alr; then
    (cd "$root/packages/ada/examples" && alr -n build >/dev/null 2>&1) \
        && capture ada "$root/packages/ada/examples/bin/live" || true
else
    wanted ada && skipped+=("ada (alr)")
fi

echo
[[ ${#skipped[@]} -gt 0 ]] && printf 'skipped: %s\n' "${skipped[*]}"

if [[ ${#ran[@]} -lt 2 ]]; then
    echo "need at least two SDKs to compare; ran: ${ran[*]:-none}" >&2
    exit 1
fi

python3 "$root/smoke/live/compare.py" "${ran[@]}"
