# AMOLED Studio

**A local simulator and firmware emulator for the Waveshare ESP32-S3-Touch-AMOLED-1.75C.**

Build and test an LVGL application in a browser or macOS desktop app, without connecting a board. Run the host-native LVGL simulator for quick iteration, or boot a real ESP32-S3 firmware binary with simulated display and touch peripherals.

> **Project status:** experimental. Only the **1.75C** board is targeted. Peripheral models are incomplete and have not been validated against physical hardware. The diagnostic firmware uses an unverified flash layout: **do not flash it to a device**.

## One-command setup (macOS)

The repository is currently **private**, so first install and sign in to [GitHub CLI](https://cli.github.com/) as an account with access (`gh auth login`). Then paste this one command into Terminal:

```sh
gh api -H 'Accept: application/vnd.github.raw+json' repos/DEFTileu/amoled-studio/contents/tools/install-macos.sh | bash
```

The installer clones the project into `~/AMOLED-Studio`, installs build dependencies with Homebrew, sets up ESP-IDF 6.1 in `~/AMOLED-Studio-toolchains`, builds the engines and frontend, and opens Studio in the browser. The first run downloads several large dependencies and may take a long time. Keep the terminal open while using Studio; stop it with **Ctrl-C**. To run it again:

```sh
cd ~/AMOLED-Studio && ./runtime/target/debug/amoled-studio serve --open
```

Apple Command Line Tools and Homebrew must already be installed. If they are missing, the installer tells you what to do. An existing checkout is reused without updating or overwriting it. Set `AMOLED_INSTALL_DIR` or `AMOLED_IDF_DIR` to choose different directories. This builds from source; there is no prebuilt downloadable installer yet.

## Manual quick start

The steps below build and start the browser version on macOS. The first build downloads dependencies; later runs use the local build. No hardware or cloud backend is required.

### 1. Install prerequisites

Install Xcode command-line tools, [Homebrew](https://brew.sh/), [Rust](https://www.rust-lang.org/tools/install), Node.js/npm, Python 3 and the [ESP-IDF toolchain](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/get-started/index.html) for ESP32-S3. The diagnostic firmware has been built with ESP-IDF 6.1.

```sh
xcode-select --install
brew install cmake pkg-config sdl2-compat sdl3
```

The emulator also needs the ESP32-S3 ROM ELF. The ESP-IDF tools normally install it under `~/.espressif/tools/esp-rom-elfs/`; see [ROM setup](docs/firmware-emulator.md#prerequisites) for alternatives.

### 2. Clone and build

```sh
git clone https://github.com/DEFTileu/amoled-studio.git
cd amoled-studio

# Adjust this path to your ESP-IDF installation.
source "$HOME/esp/esp-idf/export.sh"

cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug -DSTUDIO_ENABLE_EMULATOR_TESTS=ON
cmake --build build --parallel
./tools/setup-esp32sim.sh
idf.py -C firmware/esp-idf build
npm --prefix apps/desktop ci
npm --prefix apps/desktop run build
cargo build --locked --manifest-path runtime/Cargo.toml --bin amoled-studio
```

The setup script downloads the pinned [esp32sim](https://github.com/mikroverk/esp32sim) revision, applies the 1.75C board model, and builds it. ESP-IDF fetches the required BSP components. Build artifacts stay on your machine.

### 3. Launch

```sh
./runtime/target/debug/amoled-studio serve --open
```

The launcher starts the Rust backend, serves the frontend on `127.0.0.1`, and opens an authenticated browser tab. In Studio:

1. Select **Firmware Emulator** and press **Start**.
2. Wait for **Running**, then click **Switch screen** on the device preview or try a swipe.
3. Press **Stop** when finished. Press **Ctrl-C** in the launcher terminal to shut down the backend.

Use the tab opened by the launcher: opening the same address in a new tab does not transfer its session. If the tab was closed, launch Studio again. See [launching and session security](docs/launch.md).

## Desktop app

After completing the build above, package the macOS application:

```sh
./tools/package-macos.sh
open 'apps/desktop/src-tauri/target/release/bundle/macos/AMOLED Studio.app'
```

The bundle includes the emulator, firmware, ROM, SDL simulator and required libraries. The script checks that the packaged simulator loads its own SDL libraries. The build is **ad-hoc signed, not notarized**, and has not been verified on a clean Mac. See [packaging notes](docs/launch.md).

## Choose an engine

| | Firmware Emulator | LVGL Simulator |
| --- | --- | --- |
| Runs | Real ESP32-S3 firmware in esp32sim | Portable LVGL app on the host |
| Display | Firmware writes through the emulated CO5300 | Native SDL window |
| Input | Simulated CST9217 touch, including taps and swipes | Mouse input in the SDL window |
| Configuration | Virtual 16/32 MB flash, 8 MB PSRAM; firmware upload | Configurable hardware mocks |

Both use the same portable diagnostic app. Firmware frames come from the emulated controller; the simulator is a separate host-native engine.

## Tests

With the firmware and emulator built:

```sh
# Simulator, firmware boot, display and swipe tests
ctest --test-dir build --output-on-failure

# Runtime, HTTP/WebSocket API and real-emulator integration
STUDIO_RUNTIME_E2E=1 cargo test --locked --manifest-path runtime/Cargo.toml -- --test-threads=1

# Frontend unit tests and browser adapter integration
npm --prefix apps/desktop test
npm --prefix apps/desktop run test:integration
```

The firmware integration tests need the built images, ROM and patched esp32sim. Heavy concurrent builds can affect timing-sensitive gesture tests.

## Architecture

```text
React frontend
  ├── Browser ── HTTP / WebSocket ──┐
  └── Tauri desktop ── IPC ─────────┤
                                    ▼
                          Rust runtime supervisor
                            ├── LVGL + SDL simulator
                            └── esp32sim + 1.75C board model
```

The local API handles runtime lifecycle, firmware uploads, logs, frames and touch. It binds to loopback and uses token authentication and Origin validation. It does not provide arbitrary process execution or unrestricted filesystem access. It is not a security boundary against another process running as the same OS user. See the [HTTP/WebSocket API contract](runtime/HTTP_API.md).

## Known limitations

- Only the **ESP32-S3-Touch-AMOLED-1.75C** is supported. The 16/32 MB flash settings are virtual options; actual board capacity and RTC availability remain unconfirmed.
- CO5300 and CST9217 behavior covers the tested diagnostic firmware. PMIC, IMU, audio, RTC and timing are incomplete or unvalidated; this is not full board emulation.
- The simulator opens a separate SDL window. Browser frame capture and touch apply to firmware mode.
- A packaged app still needs clean-machine testing, a distribution signing identity and notarization before public distribution.

See [hardware notes](docs/technical-notes.md), [firmware emulation](docs/firmware-emulator.md), [launch guide](docs/launch.md), and [frontend integration](apps/desktop/README.md).

## Project structure

| Path | Purpose |
| --- | --- |
| `apps/desktop/` | Shared React frontend and Tauri shell |
| `runtime/` | Rust supervisor, local API and Tauri commands |
| `src/` | Portable LVGL app, HAL, board profile and SDL simulator |
| `firmware/esp-idf/` | Diagnostic ESP-IDF firmware |
| `emulation/esp32sim/` | 1.75C emulator model and transport patch |
| `tests/` | Simulator and firmware tests |

## License

Project code is licensed under [Apache License 2.0](LICENSE). LVGL, SDL, esp32sim, Espressif ROM files and BSP components have their own licenses; review their notices before redistributing a packaged app.
