#!/bin/bash
# Builds mac/build/RayLink.app. Needs only the Xcode Command Line Tools.
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release

APP="build/RayLink.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$(swift build -c release --show-bin-path)/RayLink" "$APP/Contents/MacOS/RayLink"
cp Info.plist "$APP/Contents/Info.plist"

# Ad-hoc signature. macOS ties the Accessibility grant to it, so the permission
# has to be re-granted after each rebuild.
codesign --force --sign - "$APP"

echo "Built $(pwd)/$APP"
