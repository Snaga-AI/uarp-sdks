#!/usr/bin/env bash
#
# Build the Ada SDK and its test suite, then run the suite against a local
# mock server. The unit tests also run without the server; this script starts
# one so the HTTP and SSE paths are covered too.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
port="${UARP_TEST_PORT:-8931}"

#  gprbuild's parallelism. Unset means its default, one job per core. CI sets
#  2; see the comment there for what that did and did not change.
jobs="${UARP_ADA_JOBS:-0}"
build_args=(-j"$jobs")
# Keep the profile's assertions/checks, but avoid optimizing and emitting huge
# debug tables for the generated model unit in correctness-only CI runs.
if [[ "${UARP_ADA_CI:-0}" == 1 ]]; then
    build_args+=(-cargs:Ada -O0 -g0)
fi

# The pinned SDK is built transitively. Building it separately first compiles
# it twice, in the root's development profile and the dependency's release one.
(cd "$here" && alr -n build -- "${build_args[@]}")

python3 "$here/mock_server.py" "$port" >/dev/null 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT

# Wait for the port to accept connections.
for _ in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:$port/echo" >/dev/null 2>&1; then
        break
    fi
    sleep 0.1
done

UARP_TEST_BASE_URL="http://127.0.0.1:$port" \
UARP_SSE_FIXTURE_DIR="$root/../../contract/sse-fixtures" \
"$here/bin/uarp_sdk_tests"
