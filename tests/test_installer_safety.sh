#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/already-here"
printf '#!/bin/sh\necho Darwin\n' > "$tmp/bin/uname"
printf '#!/bin/sh\nexit 0\n' > "$tmp/bin/xcode-select"
printf '#!/bin/sh\necho should-not-run >&2; exit 99\n' > "$tmp/bin/brew"
chmod +x "$tmp/bin/"*
printf 'keep me\n' > "$tmp/already-here/sentinel"
if PATH="$tmp/bin:$PATH" AMOLED_INSTALL_DIR="$tmp/already-here" bash "$root/tools/install-macos.sh" > "$tmp/out" 2>&1; then
  echo 'installer unexpectedly accepted an existing non-repository directory' >&2; exit 1
fi
grep -q 'Refusing to overwrite' "$tmp/out"
test "$(cat "$tmp/already-here/sentinel")" = 'keep me'
if grep -q should-not-run "$tmp/out"; then exit 1; fi
echo 'installer rejects an existing directory without modifying it'
mkdir -p "$tmp/project/.git" "$tmp/project/tools" "$tmp/project/runtime/target/debug" "$tmp/idf/.git"
cat > "$tmp/bin/git" <<'MOCK'
#!/bin/sh
case "$*" in
  *remote*get-url*) echo https://github.com/DEFTileu/amoled-studio.git ;;
  *rev-parse*) echo fff9895c82d744c7237be8847347bdd1b07c6643 ;;
  *) echo unexpected-git >&2; exit 1 ;;
esac
MOCK
for cmd in brew cmake idf.py npm cargo; do printf '#!/bin/sh\nexit 0\n' > "$tmp/bin/$cmd"; done
printf '#!/bin/sh\nexit 0\n' > "$tmp/idf/install.sh"
printf '#!/bin/sh\ntrue\n' > "$tmp/idf/export.sh"
printf '#!/bin/sh\nexit 0\n' > "$tmp/project/tools/setup-esp32sim.sh"
# shellcheck disable=SC2016
printf '#!/bin/sh\nprintf "%%s\\n" "$*" > "$AMOLED_TEST_LAUNCH"\n' > "$tmp/project/runtime/target/debug/amoled-studio"
chmod +x "$tmp/bin/"* "$tmp/idf/install.sh" "$tmp/project/tools/setup-esp32sim.sh" "$tmp/project/runtime/target/debug/amoled-studio"
if ! PATH="$tmp/bin:$PATH" AMOLED_INSTALL_DIR="$tmp/project" AMOLED_IDF_DIR="$tmp/idf" AMOLED_TEST_LAUNCH="$tmp/launched" bash "$root/tools/install-macos.sh" > "$tmp/success" 2>&1; then
  cat "$tmp/success" >&2; exit 1
fi
grep -qx 'serve --open' "$tmp/launched"
grep -q 'Using existing checkout without updating it' "$tmp/success"
echo 'installer reuses checkout and launches Studio after successful mocked build'
