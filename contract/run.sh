#!/usr/bin/env bash
#
# Cross-SDK contract check.
#
# Runs the same fixed sequence of calls (contract/SCENARIOS.md) through every
# SDK whose toolchain is installed, records what each one put on the wire, and
# fails if the traces disagree.
#
#   contract/run.sh              every available SDK
#   contract/run.sh rust ada     a subset
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${UARP_CONTRACT_PORT:-8940}"
base="http://127.0.0.1:$port"
traces="$root/contract/traces"

mkdir -p "$traces"
rm -f "$traces"/*.json

python3 "$root/contract/server.py" "$port" >/dev/null 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
    curl -fsS "$base/__reset" >/dev/null 2>&1 && break
    sleep 0.1
done

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

record() {
    local name="$1"
    curl -fsS "$base/__trace" > "$traces/$name.json"
    ran+=("$name")
}

if wanted typescript && have node; then
    echo "==> typescript"
    curl -fsS "$base/__reset" >/dev/null
    (cd "$root/packages/typescript" && npm run --silent build >/dev/null)
    UARP_CONTRACT_BASE_URL="$base" node "$root/contract/runners/typescript.ts" >/dev/null
    record typescript
else
    wanted typescript && skipped+=("typescript (node)")
fi

if wanted rust && have cargo; then
    echo "==> rust"
    curl -fsS "$base/__reset" >/dev/null
    (cd "$root/packages/rust" && UARP_CONTRACT_BASE_URL="$base" cargo run --quiet --example contract >/dev/null)
    record rust
else
    wanted rust && skipped+=("rust (cargo)")
fi

if wanted swift && have swift; then
    echo "==> swift"
    curl -fsS "$base/__reset" >/dev/null
    (cd "$root/packages/swift" && UARP_CONTRACT_BASE_URL="$base" swift run --quiet uarp-contract >/dev/null)
    record swift
else
    wanted swift && skipped+=("swift")
fi

if wanted kotlin && have java; then
    echo "==> kotlin"
    curl -fsS "$base/__reset" >/dev/null
    (cd "$root/packages/kotlin" && UARP_CONTRACT_BASE_URL="$base" ./gradlew :uarp-sdk:contract --console=plain -q >/dev/null)
    record kotlin
else
    wanted kotlin && skipped+=("kotlin (java)")
fi

if wanted ada && have alr; then
    echo "==> ada"
    curl -fsS "$base/__reset" >/dev/null
    #  The build output used to go to /dev/null, so a failure here ended the
    #  whole run with `set -e` and no explanation at all. Keep it, and let the
    #  other four SDKs still be compared if Ada cannot build.
    if (cd "$root/packages/ada/examples" && alr -n build > "$traces/ada-build.log" 2>&1); then
        (cd "$root/packages/ada/examples" && UARP_CONTRACT_BASE_URL="$base" ./bin/contract >/dev/null) \
            && record ada || echo "    ada runner failed" >&2
    else
        echo "    ada failed to build:" >&2
        tail -20 "$traces/ada-build.log" >&2
    fi
else
    wanted ada && skipped+=("ada (alr)")
fi

echo
[[ ${#skipped[@]} -gt 0 ]] && printf 'skipped: %s\n' "${skipped[*]}"

if [[ ${#ran[@]} -lt 2 ]]; then
    echo "need at least two SDKs to compare; ran: ${ran[*]:-none}" >&2
    exit 1
fi

#  What each runner decoded, reported through the server.
curl -fsS "$base/__probes" > "$traces/probes.json"

python3 "$root/contract/compare.py" "${ran[@]}"
