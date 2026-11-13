#!/bin/bash
# Install into a dedicated directory without modifying an existing checkout.
set -euo pipefail
repo='DEFTileu/amoled-studio'
install_dir="${AMOLED_INSTALL_DIR:-$HOME/AMOLED-Studio}"
idf_dir="${AMOLED_IDF_DIR:-$HOME/AMOLED-Studio-toolchains/esp-idf}"

if [ "$(uname -s)" != Darwin ]; then echo 'This installer currently supports macOS only.' >&2; exit 1; fi
if ! xcode-select -p >/dev/null 2>&1; then
  echo 'Install Apple Command Line Tools when prompted, then run this command again.' >&2
  xcode-select --install || true
  exit 1
fi
if ! command -v brew >/dev/null 2>&1; then
  echo 'Homebrew is required. Install it from https://brew.sh/ and run this command again.' >&2
  exit 1
fi
if [ -e "$install_dir" ] && [ ! -d "$install_dir/.git" ]; then
  echo "Refusing to overwrite existing directory: $install_dir" >&2; exit 1
fi
if [ -d "$install_dir/.git" ]; then
  origin="$(git -C "$install_dir" remote get-url origin 2>/dev/null || true)"
  case "$origin" in *github.com[:/]DEFTileu/amoled-studio|*github.com[:/]DEFTileu/amoled-studio.git) ;;
    *) echo "Existing directory is not the AMOLED Studio repository: $install_dir" >&2; exit 1;;
  esac
  echo "Using existing checkout without updating it: $install_dir"
else
  git clone "https://github.com/$repo.git" "$install_dir"
fi

brew install cmake pkg-config sdl2-compat sdl3 rust node python ninja
if [ ! -d "$idf_dir/.git" ]; then
  if [ -e "$idf_dir" ]; then echo "Refusing to overwrite: $idf_dir" >&2; exit 1; fi
  mkdir -p "$(dirname "$idf_dir")"
  git clone --branch v6.1 --single-branch --recursive https://github.com/espressif/esp-idf.git "$idf_dir"
else
  actual="$(git -C "$idf_dir" rev-parse HEAD)"
  if [ "$actual" != fff9895c82d744c7237be8847347bdd1b07c6643 ]; then
    echo "Existing ESP-IDF is not the tested v6.1 revision: $idf_dir" >&2; exit 1
  fi
fi
"$idf_dir/install.sh" esp32s3
# ESP-IDF's export script configures compiler and Python environment for this shell.
# shellcheck disable=SC1091
. "$idf_dir/export.sh"
cd "$install_dir"
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug -DSTUDIO_ENABLE_EMULATOR_TESTS=ON
cmake --build build --parallel 4
./tools/setup-esp32sim.sh
idf.py -C firmware/esp-idf build
npm --prefix apps/desktop ci
npm --prefix apps/desktop run build
cargo build --locked --manifest-path runtime/Cargo.toml --bin amoled-studio
cat <<MSG

AMOLED Studio is ready. Keep this terminal open while using the browser.
To launch it again later:
  cd "$install_dir" && ./runtime/target/debug/amoled-studio serve --open
MSG
exec ./runtime/target/debug/amoled-studio serve --open
