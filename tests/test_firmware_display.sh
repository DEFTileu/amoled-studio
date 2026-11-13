#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf '4.0 touch 234 264 1\n4.5 touch 234 264 0\n' > "$tmp/tap.txt"
if ! ESP32SIM_SECONDS=6 "$root/tools/run-firmware-demo.sh" --tft-png "$tmp/before.png" > "$tmp/before.log" 2>&1; then cat "$tmp/before.log" >&2; exit 1; fi
if ! ESP32SIM_SECONDS=6 "$root/tools/run-firmware-demo.sh" --script "$tmp/tap.txt" --tft-png "$tmp/after.png" > "$tmp/after.log" 2>&1; then cat "$tmp/after.log" >&2; exit 1; fi
for file in "$tmp/before.log" "$tmp/after.log"; do
  if ! grep -q 'AMOLED_FIRMWARE_LVGL_READY' "$file"; then cat "$file" >&2; echo 'LVGL startup marker missing' >&2; exit 1; fi
  if grep -E -q 'abort\(\)|Guru Meditation|ESP_ERROR_CHECK failed|chip reset' "$file"; then cat "$file" >&2; exit 1; fi
done
if ! grep -q 'AMOLED_FIRMWARE_SCREEN_1' "$tmp/after.log"; then cat "$tmp/after.log" >&2; echo 'Touch reaction marker missing' >&2; exit 1; fi
python3 "$root/tests/verify_frame.py" "$tmp/before.png" "$tmp/after.png"
