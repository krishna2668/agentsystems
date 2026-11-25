#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../permanent-gateway/chatgpt/mcp"
npm ci
./node_modules/.bin/esbuild consent/client.mjs --bundle --format=esm --platform=browser --minify --outfile=consent/client.bundle.js
node --input-type=module - <<'JS'
import fs from 'node:fs';
const assets={html:fs.readFileSync('consent/index.html','utf8'),css:fs.readFileSync('consent/style.css','utf8'),js:fs.readFileSync('consent/client.bundle.js','utf8')};
fs.writeFileSync('consent-assets.mjs','export const assets='+JSON.stringify(assets)+';\n');
JS
./node_modules/.bin/esbuild gateway.mjs --bundle --minify --format=esm --platform=browser --target=es2022 --outfile=gateway.bundle.mjs
