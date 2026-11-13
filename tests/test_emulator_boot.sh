#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
output="$(mktemp)"
trap 'rm -f "$output"' EXIT
"$root/tools/run-emulator-smoke.sh" >"$output" 2>&1 || { cat "$output" >&2; exit 1; }
if ! grep -Fq 'AMOLED_STUDIO_EMU_BOOT_OK' "$output"; then
    cat "$output" >&2
    echo 'Firmware boot marker missing' >&2
    exit 1
fi
if ! grep -Fq 'AMOLED_STUDIO_CST9217_OK' "$output"; then
    cat "$output" >&2
    echo 'Firmware touch-controller marker missing' >&2
    exit 1
fi
printf '%s\n' 'ESP32-S3 firmware and CST9217 I2C markers observed'
