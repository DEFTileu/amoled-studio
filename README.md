# AMOLED Studio

AMOLED Studio is an experimental local development environment for the **Waveshare ESP32-S3-Touch-AMOLED-1.75C**. It combines a portable LVGL simulator, an ESP32-S3 firmware emulator, a Rust runtime and one React frontend for macOS desktop and browser use. No physical board or cloud service is required.

The firmware emulator executes a real ESP-IDF binary in a patched, pinned version of [esp32sim](https://github.com/mikroverk/esp32sim). The diagnostic firmware renders LVGL through the simulated CO5300 display controller and receives touch through the CST9217 model. Hardware behavior is simulated and has not been validated against a physical board.

## Features

- **Firmware Emulator:** ESP32-S3 execution, round 466 × 466 framebuffer, snapshots and simulated touch/gestures; configurable 16 MB or 32 MB virtual flash and 8 MB virtual PSRAM.
- **LVGL Simulator:** native SDL window using the same portable diagnostic application and configurable hardware mocks.
- **Desktop Studio:** Tauri 2 shell with an in-process Rust runtime; the macOS bundle includes the runtime assets.
- **Browser Studio:** the same frontend served with an authenticated loopback HTTP/WebSocket API by the Rust runtime. Supports selecting and uploading firmware image bundles.
- **Local API:** versioned lifecycle, configuration, firmware upload, logs, frames and touch APIs. See [API v1](runtime/HTTP_API.md).

The two engines are separate: the LVGL simulator renders on the host, while firmware frames originate from emulated firmware display writes. Neither mode flashes hardware.

## Requirements

The documented development and packaging path targets macOS. You will need:

- Xcode command-line tools, Git, CMake, pkg-config, Python 3, Rust/Cargo and Node.js/npm.
- Homebrew SDL dependencies: `brew install cmake pkg-config sdl2-compat sdl3`.
- [Espressif ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/get-started/index.html) with the ESP32-S3 toolchain; the existing diagnostic firmware has been built with ESP-IDF 6.1.
- The ESP32-S3 ROM ELF installed by ESP-IDF or supplied via `ESP32SIM_ROM_DIR`. See [firmware emulator setup](docs/firmware-emulator.md).
- Internet access for the initial dependency downloads. Running a prepared build does not require a cloud backend.

## Build from source

From the project root, activate your ESP-IDF installation and build the engines:

```sh
source "$HOME/esp/esp-idf/export.sh"  # adjust to your installation
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug -DSTUDIO_ENABLE_EMULATOR_TESTS=ON
cmake --build build --parallel
./tools/setup-esp32sim.sh
idf.py -C firmware/esp-idf build
npm --prefix apps/desktop ci
npm --prefix apps/desktop run build
cargo build --locked --manifest-path runtime/Cargo.toml --bin amoled-studio
```

The setup script downloads the pinned emulator source, applies the local board model and builds the emulator. ESP-IDF downloads the BSP components specified in the project. Build products and downloaded dependencies remain local and are excluded from Git.

### Browser

```sh
./runtime/target/debug/amoled-studio serve --open
```

The launcher starts the backend and frontend on one local origin and opens an authorized browser tab. Close the server with Ctrl-C. Open the tab created by the launcher: a separately opened tab does not automatically receive its session. See [launch and session details](docs/launch.md).

### macOS app

After building the prerequisites above:

```sh
./tools/package-macos.sh
```

The app is produced at `apps/desktop/src-tauri/target/release/bundle/macos/AMOLED Studio.app`. The script packages SDL, esp32sim, the ROM and firmware assets and checks the relocated simulator. The resulting app is locally ad-hoc signed; it is **not notarized** for public distribution.

## Tests

```sh
ctest --test-dir build --output-on-failure
STUDIO_RUNTIME_E2E=1 cargo test --locked --manifest-path runtime/Cargo.toml -- --test-threads=1
npm --prefix apps/desktop test
npm --prefix apps/desktop run test:integration
```

Firmware end-to-end tests need the built ESP-IDF images, ROM and patched esp32sim. The browser integration suite uses the local backend; see [desktop development notes](apps/desktop/README.md). Running timing-sensitive firmware tests alongside heavy builds can cause intermittent gesture-test failures.

## Project layout

| Path | Contents |
| --- | --- |
| `runtime/` | Shared Rust supervisor, authenticated local API and Tauri command adapter |
| `apps/desktop/` | Shared React frontend and optional Tauri shell |
| `src/` | Portable LVGL app, board profile, HAL and SDL simulator |
| `firmware/esp-idf/` | Diagnostic firmware using ESP-IDF and the Waveshare BSP |
| `emulation/esp32sim/` | 1.75C board model and emulator transport patch |
| `tests/` | Simulator and firmware integration tests |

## Scope and limitations

Only the 1.75C board is targeted. Display and touch models support the tested diagnostic firmware, not full hardware or BSP compatibility. PMIC, IMU, audio, RTC, timing and other peripherals are incomplete or unvalidated. Real-board flash capacity and RTC availability remain uncertain; virtual flash choices are not a hardware claim. The sample firmware uses an unverified flash layout and **must not be flashed**. See [technical notes](docs/technical-notes.md) and [emulation feasibility](docs/emulation-feasibility.md).

The local API binds to loopback and uses authentication and Origin checks. It is not a security boundary against another process running as the same OS user. See [API security and lifecycle](runtime/HTTP_API.md).

## License

Project code is licensed under [Apache License 2.0](LICENSE). LVGL, SDL, esp32sim, Espressif ROM files and BSP components have their own licenses; review their notices when redistributing a packaged app.
