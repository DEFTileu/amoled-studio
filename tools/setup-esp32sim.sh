#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
revision=a57c5e0a29ac9655d2968f5ef0eb0e77e9cd05c5
source_dir="${ESP32SIM_SOURCE:-$root/.tools/esp32sim}"
if [[ ! -d "$source_dir/.git" ]]; then
    mkdir -p "$source_dir"
    git -C "$source_dir" init -q
    git -C "$source_dir" remote add origin https://github.com/mikroverk/esp32sim.git
    git -C "$source_dir" fetch --depth 1 origin "$revision"
    git -C "$source_dir" checkout --detach FETCH_HEAD
fi
if [[ "$(git -C "$source_dir" rev-parse HEAD)" != "$revision" ]]; then
    echo "esp32sim checkout must be at $revision: $source_dir" >&2; exit 1
fi
if ! cmp -s "$root/emulation/esp32sim/waveshare_175c.rs" "$source_dir/esp32s3/src/board/waveshare_175c.rs"; then
    cp "$root/emulation/esp32sim/waveshare_175c.rs" "$source_dir/esp32s3/src/board/waveshare_175c.rs"
fi
python3 - "$source_dir/esp32s3/src/board/mod.rs" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text(); original = s
if 'pub mod waveshare_175c;' not in s:
    s = s.replace('pub mod waveshare_amoled18;', 'pub mod waveshare_amoled18;\npub mod waveshare_175c;')
entry = '        "waveshare-amoled175c" => Some(Box::new(waveshare_175c::Waveshare175c::new())),\n'
if entry not in s:
    needle = '        _ => None,\n'
    if needle not in s: raise SystemExit('esp32sim board factory format changed')
    s = s.replace(needle, entry + needle, 1)
if s != original: p.write_text(s)
PY
python3 - "$source_dir/web/run.html" <<'PYVIEWER'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text(); original = s
line = "    if (m.t === 'board' && m.name === 'waveshare-amoled175c') { $('#lcdpanel').style.display = ''; $('#lcdstat').textContent = '1.75C CO5300: click or drag to touch'; const lcd = $('#lcd'); lcd.style.width = '466px'; lcd.style.height = '466px'; }\n"
if line not in s:
    needle = "    if (m.t === 'board' && m.name === 'waveshare-amoled18-v2')"
    if needle not in s: raise SystemExit('esp32sim viewer format changed')
    s = s.replace(needle, line + needle, 1)
if s != original: p.write_text(s)
PYVIEWER
python3 - "$source_dir/web/workbench.js" <<'PYMETADATA'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text(); original = s
entry = "    'waveshare-amoled175c': { soc: 'ESP32-S3 rev 0', cpu: '2× Xtensa LX7 @ 240 MHz', board: 'Waveshare AMOLED-1.75C', peripherals: 'CO5300 466×466 QSPI · CST9217 touch' },\n"
if entry not in s:
    needle = "    'waveshare-amoled18-v2':"
    if needle not in s: raise SystemExit('esp32sim metadata format changed')
    s = s.replace(needle, entry + needle, 1)
if s != original: p.write_text(s)
PYMETADATA
python3 "$root/emulation/esp32sim/patch_private_web.py" "$source_dir/esp-soc/src/web.rs"
cargo test --manifest-path "$source_dir/Cargo.toml" -p esp32s3 --lib board::waveshare_175c::tests
cargo build --manifest-path "$source_dir/Cargo.toml" --release -p esp32sim --bin esp32sim
