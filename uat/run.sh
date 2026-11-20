#!/usr/bin/env bash
# Draait de UAT tegen artifact/brainstorm.html in een nagebootste claude.ai-omgeving.
# Nodig: Node 20+, Playwright met Chromium, en `npm install` (voor morphdom en axe-core).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .site
{ printf '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'; cat ../artifact/brainstorm.html; printf '</body></html>'; } > .site/index.html
python3 -m http.server 3456 --directory .site >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
node ${UAT_FILE:-uat.cjs}
