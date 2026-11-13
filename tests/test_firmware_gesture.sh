#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
if ! ESP32SIM_SECONDS=6 "$root/tools/run-firmware-demo.sh" --script "$root/tests/firmware-swipe.txt" >"$log" 2>&1; then cat "$log" >&2; exit 1; fi
if ! grep -q 'AMOLED_FIRMWARE_LVGL_READY' "$log" || ! grep -q 'AMOLED_FIRMWARE_SCREEN_1' "$log" || grep -E -q 'abort\(\)|Guru Meditation|ESP_ERROR_CHECK failed|chip reset' "$log"; then
  cat "$log" >&2; echo 'firmware swipe failed' >&2; exit 1
fi
printf '%s\n' 'Firmware received simulated swipe and changed screen'
