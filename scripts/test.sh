#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --test permanent-gateway/edge/worker.test.mjs permanent-gateway/chatgpt/*.test.mjs permanent-gateway/chatgpt/mcp/*.test.mjs scripts/*.test.mjs
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
javac -d "$out" product-src/dev/worker/test/{StartIntent,Execution,AnimaticSpec,MediaExecution,OriginTransition,ArtifactLibrary,PreviewLink,ArtifactDownload}.java product-tests/dev/worker/test/*.java
for t in StartIntentTest AnimaticSpecTest MediaExecutionTest OriginTransitionTest PreviewLinkTest ArtifactDownloadTest; do java -cp "$out" "dev.worker.test.$t"; done
bash permanent-gateway/tests/run-local.sh
