#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
: "${ESP32SIM_BIN:=$root/.tools/esp32sim/target/release/esp32sim}"
: "${ESP32SIM_FLASH_MB:=16}"
: "${ESP32SIM_PSRAM_MB:=8}"
: "${ESP32SIM_SECONDS:=8}"
build="$root/firmware/esp-idf/build"
if [[ ! -x "$ESP32SIM_BIN" ]]; then echo "esp32sim is missing; run tools/setup-esp32sim.sh" >&2; exit 1; fi
for image in "$build/bootloader/bootloader.bin" "$build/partition_table/partition-table.bin" "$build/amoled_studio_175c.bin" "$build/amoled_studio_175c.elf"; do
    if [[ ! -f "$image" ]]; then echo "Missing firmware image: $image" >&2; exit 1; fi
done
exec "$ESP32SIM_BIN" --chip s3 --board waveshare-amoled175c --boot rom --console uart0 \
    --flash-mb "$ESP32SIM_FLASH_MB" --psram-mb "$ESP32SIM_PSRAM_MB" \
    --bootloader "$build/bootloader/bootloader.bin" --ptable "$build/partition_table/partition-table.bin" \
    --app "$build/amoled_studio_175c.bin" --elf "$build/amoled_studio_175c.elf" \
    --max-seconds "$ESP32SIM_SECONDS" --no-dump "$@"
