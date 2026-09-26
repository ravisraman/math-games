#!/usr/bin/env bash
# Runs the Math Quest checks against a local copy of the site.
# Needs Node 18+ and Playwright:  npm install  &&  npx playwright install chromium
set -u
cd "$(dirname "$0")/.."
PORT=8765
python3 -m http.server $PORT >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
status=0
for t in worker-unit.mjs phone-journey.js sync-scenarios.js voice-storm.js; do
  echo "=== $t"
  node "tests/$t" || status=1
done
if [ "${VOICE_LIVE:-0}" = "1" ]; then
  echo "=== voice-test.js (uses the live Cloudflare voice)"
  node tests/voice-test.js || status=1
fi
exit $status
