#!/usr/bin/env bash
#
# Publish the Kotlin artifacts to Maven Central through the Portal API.
#
# Central does not accept a Maven deploy. Its upload endpoint takes one zip
# holding the whole repository layout, posted in a single request, and answers a
# per-file PUT with 404 — which is what a plain Gradle `maven { url = … }`
# publish sends. So the artifacts are staged into a directory, zipped, posted,
# and then polled: validation is asynchronous and a bundle that fails it is
# never published.
#
#   MAVEN_USERNAME=… MAVEN_PASSWORD=… scripts/publish-maven.sh <version> [staging-dir]
set -euo pipefail

version="${1:?usage: publish-maven.sh <version> [staging-dir]}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
staging="${2:-$root/packages/kotlin/build/staging}"

: "${MAVEN_USERNAME:?MAVEN_USERNAME is not set}"
: "${MAVEN_PASSWORD:?MAVEN_PASSWORD is not set}"

test -d "$staging/ai" || {
    echo "publish-maven: nothing staged in $staging" >&2
    exit 1
}

bundle="$(mktemp -d)/bundle.zip"
(cd "$staging" && zip -qr "$bundle" ai)
echo "publish-maven: bundle is $(du -h "$bundle" | cut -f1)"

auth=$(printf '%s:%s' "$MAVEN_USERNAME" "$MAVEN_PASSWORD" | base64 | tr -d '\n')
api=https://central.sonatype.com/api/v1/publisher

id=$(curl -sS --fail -X POST \
    -H "Authorization: Bearer $auth" \
    -F "bundle=@$bundle" \
    "$api/upload?name=uarp-sdk-${version}&publishingType=AUTOMATIC")
echo "publish-maven: deployment $id"

#  Validation runs after the upload returns, so the exit code above says
#  nothing about whether the release is acceptable.
for _ in $(seq 1 60); do
    status=$(curl -sS -X POST -H "Authorization: Bearer $auth" "$api/status?id=$id")
    state=$(printf '%s' "$status" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("deploymentState",""))')
    case "$state" in
        PUBLISHED|PUBLISHING)
            echo "publish-maven: $state"
            exit 0
            ;;
        FAILED)
            echo "publish-maven: validation failed" >&2
            printf '%s' "$status" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin).get("errors", {}), indent=2))' >&2
            #  Re-running a release must not fail on a version already out.
            if printf '%s' "$status" | grep -qi "already exists\|already published"; then
                echo "publish-maven: this version is already on Central; nothing to do"
                exit 0
            fi
            exit 1
            ;;
        *)
            echo "publish-maven: $state"
            sleep 10
            ;;
    esac
done

echo "publish-maven: gave up waiting; check https://central.sonatype.com/publishing/deployments" >&2
exit 1
