#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
sdk="${ANDROID_HOME:-/opt/android-sdk}"
bt="$sdk/build-tools/36.0.0"
rm -rf product-build/classes
mkdir -p product-build/classes
javac -source 8 -target 8 -classpath "$sdk/platforms/android-36/android.jar" -d product-build/classes product-src/dev/worker/test/*.java
"$bt/d8" --min-api 26 --lib "$sdk/platforms/android-36/android.jar" --output product-build $(find product-build/classes -name "*.class")
"$bt/aapt2" link -I "$sdk/platforms/android-36/android.jar" --manifest product-src/AndroidManifest.xml -o product-build/unsigned.apk
python3 - <<'PY'
import zipfile
with zipfile.ZipFile('product-build/unsigned.apk','a') as z:z.write('product-build/classes.dex','classes.dex',compress_type=zipfile.ZIP_DEFLATED)
PY
"$bt/zipalign" -f 4 product-build/unsigned.apk product-build/aligned.apk
key="${TEST_KEYSTORE:-$HOME/.android/debug.keystore}"
"$bt/apksigner" sign --ks "$key" --ks-pass pass:android --key-pass pass:android --out product-build/worker-0.9-media-candidate.apk product-build/aligned.apk
"$bt/apksigner" verify --verbose product-build/worker-0.9-media-candidate.apk
"$bt/aapt2" dump badging product-build/worker-0.9-media-candidate.apk | head -12
