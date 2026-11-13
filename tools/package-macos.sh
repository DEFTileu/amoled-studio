#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
stage="$root/build/desktop-package"
rom_dir="${ESP32SIM_ROM_DIR:-$HOME/.espressif/tools/esp-rom-elfs/20241011}"
sdl2="$(brew --prefix sdl2-compat)/lib/libSDL2-2.0.0.dylib"
sdl3="$(brew --prefix sdl3)/lib/libSDL3.dylib"
for file in "$root/build/amoled-simulator" "$root/.tools/esp32sim/target/release/esp32sim" "$root/firmware/esp-idf/build/amoled_studio_175c.bin" "$rom_dir/esp32s3_rev0_rom.elf" "$sdl2" "$sdl3"; do
  [ -f "$file" ] || { echo "Required packaging input missing: $file" >&2; exit 1; }
done
mkdir -p "$stage/build" "$stage/rom" "$stage/licenses"
rm -f "$stage/build/libSDL2-2.0.0.dylib" "$stage/build/libSDL3.dylib"
cp "$root/build/amoled-simulator" "$stage/build/amoled-simulator"
cp -L "$sdl2" "$stage/build/libSDL2-2.0.0.dylib"
cp -L "$sdl3" "$stage/build/libSDL3.dylib"
chmod u+w "$stage/build/libSDL2-2.0.0.dylib" "$stage/build/libSDL3.dylib"
# Tauri stages resources beside its release binary and overwrites them on rebuild.
if [ -d "$root/apps/desktop/src-tauri/target/release/studio-root" ]; then
  chmod -R u+w "$root/apps/desktop/src-tauri/target/release/studio-root"
fi
linked_sdl2="$(otool -L "$stage/build/amoled-simulator" | awk '/libSDL2.*[.]dylib / {print $1; exit}')"
if [ -z "$linked_sdl2" ]; then
  echo 'Simulator has no supported dynamic SDL2 dependency' >&2
  exit 1
fi
if [ ! -f "$linked_sdl2" ] || ! cmp -s "$linked_sdl2" "$sdl2"; then
  echo "Simulator links $linked_sdl2, not the SDL2 compatibility library selected for packaging; rebuild with Homebrew sdl2-compat" >&2
  exit 1
fi
install_name_tool -change "$linked_sdl2" '@rpath/libSDL2-2.0.0.dylib' "$stage/build/amoled-simulator"
if ! otool -l "$stage/build/amoled-simulator" | grep -A2 LC_RPATH | grep -q 'path @executable_path '; then
  install_name_tool -add_rpath '@executable_path' "$stage/build/amoled-simulator"
fi
install_name_tool -id '@rpath/libSDL2-2.0.0.dylib' "$stage/build/libSDL2-2.0.0.dylib"
install_name_tool -id '@rpath/libSDL3.dylib' "$stage/build/libSDL3.dylib"
codesign --force --sign - "$stage/build/libSDL2-2.0.0.dylib"
codesign --force --sign - "$stage/build/libSDL3.dylib"
codesign --force --sign - "$stage/build/amoled-simulator"
cp "$rom_dir/esp32s3_rev0_rom.elf" "$stage/rom/esp32s3_rev0_rom.elf"
cp "$root/.tools/esp32sim/LICENSE" "$stage/licenses/esp32sim-LICENSE"
cp "$(brew --prefix)/share/licenses/sdl2-compat/LICENSE.txt" "$stage/licenses/SDL2-compat-LICENSE"
cp "$(brew --prefix)/share/licenses/sdl3/LICENSE.txt" "$stage/licenses/SDL3-LICENSE"
cp "$root/LICENSE" "$stage/licenses/esp-rom-elfs-APACHE-2.0"
cd "$root/apps/desktop"
npm run tauri -- build --config src-tauri/tauri.complete.conf.json
app="$root/apps/desktop/src-tauri/target/release/bundle/macos/AMOLED Studio.app"
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
python3 "$root/tests/test_macos_packaged_simulator.py" "$app/Contents/Resources/studio-root"
