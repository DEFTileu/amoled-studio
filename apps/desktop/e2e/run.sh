#!/usr/bin/env bash
# Runs the in-webview self-test against the DEBUG Tauri binary (the hook is compiled out of release builds).
# Usage: e2e/run.sh [out-dir]   (build first: npx tauri build --debug --no-bundle)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-$(mktemp -d)}"
rm -rf "$OUT"; mkdir -p "$OUT"
AMOLED_STUDIO_E2E="$PWD/e2e/studio-e2e.js" AMOLED_STUDIO_E2E_OUT="$OUT" \
  timeout 420 ./src-tauri/target/debug/amoled-studio >"$OUT/app.log" 2>&1 || echo "app exited rc=$?"
echo "results: $OUT/results.json"
python3 - "$OUT/results.json" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1]))
for x in r: print(("PASS " if x["ok"] else "FAIL ") + x["step"] + ("  — " + x["detail"][:200] if x["detail"] else ""))
sys.exit(0 if all(x["ok"] for x in r) else 1)
EOF
