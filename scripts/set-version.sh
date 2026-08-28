#!/usr/bin/env bash
#
# Set the SDK version everywhere at once.
#
#   scripts/set-version.sh 0.3.0
#
# The `VERSION` file is the source of truth: the generator reads it and bakes
# it into each package's metadata. This script updates it, then the handful of
# manifests that carry their own copy, then regenerates.
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "usage: $(basename "$0") <version>" >&2
    exit 2
fi

version="$1"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "not a semantic version: $version" >&2
    exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Portable in-place sed: BSD needs an argument to -i, GNU must not get one.
edit() {
    local pattern="$1" file="$2"
    if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' -E "$pattern" "$file"
    else
        sed -i -E "$pattern" "$file"
    fi
}

echo "$version" > VERSION

edit "s/^  \"version\": \".*\"/  \"version\": \"$version\"/" packages/typescript/package.json
edit "s/^  \"version\": \".*\"/  \"version\": \"$version\"/" generator/package.json

# The lockfile carries the package's own version TWICE — at the root and again
# under `packages[""]` — and npm keeps both in step. This script edited only
# package.json, so every release left the lockfile a version behind: on
# 2026-08-21 `main` had package.json at 0.5.13 and the lockfile at 0.5.12.
#
# Edited as JSON, not with sed, and that is not fastidiousness. In
# lockfileVersion 3 the `packages[""]` version sits at the SAME six-space
# indent as every dependency's version:
#
#       "version": "0.5.12",     <- packages[""]  (ours)
#       "version": "22.20.1",    <- a dependency  (not ours)
#
# so an anchored line-pattern rewrites every dependency in the tree to the SDK
# version while looking exactly like a version bump. Two keys are addressed by
# path instead; nothing else in the file is touched.
node -e '
  const fs = require("fs");
  const f = "packages/typescript/package-lock.json";
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  d.version = process.argv[1];
  if (d.packages && d.packages[""]) d.packages[""].version = process.argv[1];
  fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n");
' "$version"
edit "s/^version = \".*\"/version = \"$version\"/" packages/rust/Cargo.toml
edit "s/^    version = \".*\"/    version = \"$version\"/" packages/kotlin/build.gradle.kts

for crate in packages/ada/alire.toml packages/ada/tests/alire.toml packages/ada/examples/alire.toml; do
    edit "s/^version = \".*\"/version = \"$version\"/" "$crate"
done

# The Ada root package names the version for the hand-written client.
edit "s/SDK_Version : constant String := \".*\"/SDK_Version : constant String := \"$version\"/" \
    packages/ada/src/uarp.ads

node generator/src/index.ts >/dev/null

echo "set to $version:"
grep -h "\"version\"" packages/typescript/package.json | head -1
grep -h "^version" packages/rust/Cargo.toml | head -1
grep -h "version = " packages/kotlin/build.gradle.kts | head -1
grep -h "^version" packages/ada/alire.toml | head -1
echo
echo "next: update CHANGELOG.md, commit, then tag v$version"
