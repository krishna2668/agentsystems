#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
bt="$ANDROID_HOME/build-tools/36.0.0"
# Build the native Companion and the unchanged Java Worker together.
# This is a private debug-signed acceptance build, not a public release.
if grep -q 'https://gateway.example.invalid' product-src/dev/worker/test/MainActivity.java ||
   grep -q 'android:host="gateway.example.invalid"' android-app/src/main/AndroidManifest.xml; then
  echo 'Configure an isolated deployment checkout before building a device candidate.' >&2
  exit 1
fi
./gradlew --no-daemon :android-app:assembleDebug
mkdir -p product-build
apk=product-build/agentsystems-0.13-visual-review-candidate.apk
cp android-app/build/outputs/apk/debug/android-app-debug.apk "$apk"
"$bt/apksigner" verify --verbose --print-certs "$apk"
sha256sum "$apk"
