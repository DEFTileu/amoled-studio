# Launching AMOLED Studio

Build the simulator, ESP-IDF firmware and patched esp32sim first, as described in the repository README. From the repository root, build the frontend and install the local launcher:

```sh
npm --prefix apps/desktop ci
npm --prefix apps/desktop run build
cargo install --locked --path runtime --bin amoled-studio
amoled-studio serve --open
```

The launcher serves the built frontend and API from one loopback origin, opens the default browser, and stops its own runtime on Ctrl-C or SIGTERM. An ephemeral port is chosen by default; `--port 12345` requests a specific port, and an occupied port fails without killing the other process. Run from the project root or pass `--project /path/to/project`. Launching with `serve` without `--open` prints a one-use URL for manual opening. This URL grants a session: do not share or log it. A browser tab can refresh its session; to open a new tab or browser, launch a new server. The simulator still opens its native SDL window; firmware frames and touch use the browser preview. The browser adapter supports the bundled firmware and browser-selected firmware uploads through the validated HTTP API; selected files are sent as image bundles and referenced by an opaque image ID.

The launcher puts a random, one-use bootstrap nonce in the URL fragment. The browser removes the fragment and exchanges it with an exact-same-origin POST for a distinct API bearer token, which it keeps in session storage. The nonce is never sent in a URL request or Referer. API HTTP requests require the bearer token and WebSocket clients authenticate with the first message. Foreign Origins and invalid Host headers are rejected. This protects against ordinary cross-origin websites; another process running as the same OS user is outside this boundary. A process listing may briefly show the one-use URL while the OS opens the browser. Closing a tab does not stop the server; terminate the launcher to release its child and port.

On macOS, `tools/package-macos.sh` builds a Tauri app using already-built local artifacts. The generated bundle includes the simulator, SDL libraries, esp32sim, diagnostic firmware and ESP32-S3 ROM ELF. Set `ESP32SIM_ROM_DIR` if the ESP-IDF ROM files are installed elsewhere. The script uses Homebrew SDL2 compatibility and SDL3; inspect third-party license obligations before distribution. Espressif describes the ROM ELF license and third-party notices at [esp-rom-elfs](https://github.com/espressif/esp-rom-elfs). The app uses the in-process runtime and does not need a development server. A local ad-hoc build is not a notarized public release.

Use `tools/package-macos.sh` for the complete macOS app; the separate `tauri.release.conf.json` does not include the SDL simulator. The packaging script rewrites the simulator's SDL2 link to `@rpath`, bundles the matching SDL2 compatibility and SDL3 libraries, signs them, and tests a relocated copy with an empty home directory and dyld library tracing. Homebrew is needed to build the package but is not needed at runtime. Repeat that verification on an existing bundle with:

```sh
python3 tests/test_macos_packaged_simulator.py 'apps/desktop/src-tauri/target/release/bundle/macos/AMOLED Studio.app/Contents/Resources/studio-root'
```

For API clients, see [HTTP API v1](../runtime/HTTP_API.md). Hardware and firmware behavior are simulated; no physical hardware or flashing is required.
