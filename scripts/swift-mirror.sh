#!/usr/bin/env bash
#
# Assemble the SwiftPM mirror.
#
# SwiftPM resolves a git URL and expects Package.swift at the repository root,
# so a package inside a monorepo cannot be depended upon at all. This builds the
# directory that becomes snaga-ai/uarp-swift.
#
# The contract and live runners are dropped: they exist to test the SDK against
# a server, they would appear as executable products to anyone who depends on
# the package, and they are no use outside this repository. Rather than keep a
# second Package.swift that can drift, the blocks that declare them are marked
# in the real one and stripped here.
#
#   scripts/swift-mirror.sh <destination>
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
destination="${1:?usage: swift-mirror.sh <destination>}"

mkdir -p "$destination"
#  Everything except the destination's own git metadata, so a file deleted
#  upstream disappears from the mirror too.
find "$destination" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

cp -R "$root/packages/swift/." "$destination/"
cp "$root/CHANGELOG.md" "$destination/"
rm -rf "$destination/.build" "$destination/.swiftpm"
rm -rf "$destination/Sources/UARPContract" "$destination/Sources/UARPLive"

#  Drop the marked blocks from Package.swift.
awk '
  /mirror:strip-start/ { skipping = 1; next }
  /mirror:strip-end/   { skipping = 0; next }
  !skipping            { print }
' "$root/packages/swift/Package.swift" > "$destination/Package.swift"

if grep -q "UARPContract\|UARPLive" "$destination/Package.swift"; then
    echo "swift-mirror: the harness targets survived the strip; check the markers" >&2
    exit 1
fi

echo "swift-mirror: assembled in $destination"
