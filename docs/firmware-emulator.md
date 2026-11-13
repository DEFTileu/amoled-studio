# ESP32-S3 firmware execution proof of concept

This experiment executes real, locally built ESP-IDF firmware on a pinned [esp32sim](https://github.com/mikroverk/esp32sim) Xtensa emulator. The 1.75C BSP starts LVGL, writes through the emulated CO5300, and reads injected CST9217 touch reports. It does not require or access a physical device. It is not full 1.75C firmware emulation or hardware validation.

## Prerequisites

- macOS, Git, Rust/Cargo and Python 3.
- An activated official ESP-IDF toolchain for ESP32-S3; this proof was built with ESP-IDF v6.1. Installation and activation instructions are in [Espressif's guide](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/get-started/index.html).
- The ESP32-S3 ROM ELF. esp32sim finds Espressif's ROM automatically when installed under `~/.espressif/tools/esp-rom-elfs/`; otherwise follow [esp32sim's ROM instructions](https://github.com/mikroverk/esp32sim/blob/a57c5e0a29ac9655d2968f5ef0eb0e77e9cd05c5/docs/quick-start.md) and set `ESP32SIM_ROM_DIR`. ROMs are distributed separately by Espressif and retain their own license.
- Internet access for the initial source and dependency downloads. No cloud service is used at runtime.

## Build and test

From the AMOLED Studio project root:

```sh
source "$HOME/esp/esp-idf/export.sh" # replace with the path to your ESP-IDF installation
./tools/setup-esp32sim.sh
idf.py -C firmware/emulator-smoke set-target esp32s3 build
idf.py -C firmware/esp-idf set-target esp32s3 build
./tests/test_emulator_boot.sh
./tests/test_firmware_display.sh
```

The setup script fetches esp32sim commit `a57c5e0a29ac9655d2968f5ef0eb0e77e9cd05c5`, applies the local board overlay and a small 1.75C configuration for esp32sim’s existing local viewer in `.tools/esp32sim`, runs its five model tests, and builds the emulator. The upstream repository is MIT licensed; the overlay is project code under this repository's Apache-2.0 license. Override the checkout path with `ESP32SIM_SOURCE` and the executable path with `ESP32SIM_BIN` when necessary. Existing alternative checkouts must be at the pinned revision; the setup script modifies their board factory and overlay file.

`./tools/run-emulator-smoke.sh` shows the full ROM, bootloader, firmware serial output and emulator report. The test succeeds only if both `AMOLED_STUDIO_EMU_BOOT_OK` and `AMOLED_STUDIO_CST9217_OK` appear. The second marker requires the firmware's ESP-IDF I²C driver to address `0x5a` and read the emulated resolution registers. Run the optional CTest integration alongside the simulator suite with:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug -DSTUDIO_ENABLE_EMULATOR_TESTS=ON
cmake --build build --parallel
ctest --test-dir build --output-on-failure
```

Virtual flash and PSRAM sizes can be changed without a board: for example `ESP32SIM_FLASH_MB=32 ESP32SIM_PSRAM_MB=8 ./tests/test_emulator_boot.sh`. The minimal firmware's generated image header uses the ESP-IDF default 2 MB layout; it is a test image, not a 1.75C flash configuration. Do not flash it. Time is bounded by `ESP32SIM_SECONDS` (default 5 virtual seconds).

## Live firmware viewer

```sh
ESP32SIM_SECONDS=300 ./tools/run-firmware-demo.sh --web 8766
```

Open `http://127.0.0.1:8766/run.html` on the same Mac. After boot, click the button on the round display: the ESP32-S3 firmware should switch screens. The server stops after the configured number of emulated seconds; press Ctrl-C to stop earlier. It binds to loopback, and the viewer is esp32sim's existing local web viewer with a small board registration, not the Desktop Studio frontend. The host LVGL simulator (`./build/amoled-simulator`) remains a separate mode. Both use the same portable diagnostic LVGL application; the firmware viewer streams the emulated controller framebuffer, never a host-rendered LVGL frame.

For a deterministic firmware-generated capture, use `./tools/run-firmware-demo.sh --tft-png frame.png`. The integration test runs the firmware twice with a scripted touch in the second run and checks boot/LVGL markers, a real screen-change marker, clipped corners, button pixels and the changed image. It runs under both 16 MB and 32 MB virtual-flash settings when optional CTest integration is enabled.

## Board-model scope

The board overlay models CO5300 SPI host 2 command transfers using esp32sim's existing RGB565 framebuffer (466 × 466, column offset 6), a limited single-contact CST9217 I²C device at `0x5a`, GPIO11 active-low touch interrupt edges, and display reset on GPIO1. The resolution and touch report bytes follow the official [1.75C BSP](https://components.espressif.com/components/waveshare/esp32_s3_touch_amoled_1_75c/versions/3.0.0) and `waveshare/esp_lcd_touch_cst9217` 2.0.0 driver. An AXP2101 initialization stub and esp32sim's QMI8658 model are attached; they are not hardware-validated. Five Rust tests check board attachments, panel column offset and pixel writes, touch report packing, short-tap interrupt edges, and queued touch reports.

Limitations: the model masks pixels outside the round display only in its host-visible output; the emulated controller retains its full rectangular framebuffer. Viewer coordinates are translated to raw touch coordinates to match the BSP's default X/Y mirroring. Touch interrupts are simulated as active-low pulses for each report, including release; timing is synthetic, not measured hardware behavior. The board makes the I²C devices available to either emulated controller, as the physical bus can be routed to either controller. Controller pin routing, display power, real TE timing, complete PMIC behavior, full CST9217 command/identity/reset behavior, reliable interrupt redelivery for arbitrarily short taps, multitouch, sensor accuracy, audio and any RTC are not validated. Unknown CST9217 registers read zero in the stub. LVGL gesture recognition is enabled and a scripted single-finger swipe is tested; multitouch gestures remain unsupported by this single-contact model. The firmware image header uses an unverified 2 MB layout and must not be flashed.

The framebuffer capture and touch response are verified in the emulator, not on physical hardware. The next milestone is to improve the documented device gaps and test additional firmware and input sequences without claiming full BSP compatibility.
