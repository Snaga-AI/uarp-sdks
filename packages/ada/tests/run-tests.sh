#!/usr/bin/env bash
#
# Build the Ada SDK and its test suite, then run the suite against a local
# mock server. The unit tests also run without the server; this script starts
# one so the HTTP and SSE paths are covered too.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
port="${UARP_TEST_PORT:-8931}"

cd "$root"
alr -n build
(cd "$here" && alr -n build)

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

UARP_TEST_BASE_URL="http://127.0.0.1:$port" "$here/bin/uarp_sdk_tests"
