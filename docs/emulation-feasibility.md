# Firmware emulation feasibility for 1.75C

This comparison preceded the proof of concept. A minimal ESP-IDF binary now boots with the local esp32sim 1.75C overlay; see [firmware emulator instructions](firmware-emulator.md). No physical hardware has been tested.

## Candidates

[esp32sim](https://github.com/mikroverk/esp32sim) is the stronger candidate for a future 1.75C board model: its documented ESP32-S3 engine executes the ROM, bootloader and unmodified FreeRTOS applications, and its [peripheral table](https://github.com/mikroverk/esp32sim/blob/main/docs/peripherals.md) lists dual-core interrupt handling, flash/MMU, octal PSRAM, GPIO and I²C/SPI machinery. Its [board documentation](https://github.com/mikroverk/esp32sim/blob/main/docs/boards.md) describes a reusable CO5300 QSPI model and a different Waveshare AMOLED board. That board is not a 1.75C: it has different wiring and CST820 touch. Existing AXP2101 and QMI8658 models are described as initialization-compatible stubs, not faithful sensors. The local 1.75C overlay now provides round host output, panel writes and a limited CST9217 report and interrupt path; GPIO details and meaningful AXP2101/QMI8658 behavior still need broader verification. Audio ES8311/ES7210 and amplifier behavior also need assessment and possibly models. RTC must not be assumed.

[Espressif QEMU](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-guides/tools/qemu.html) is a useful independent CPU/boot baseline. Espressif's [feature matrix](https://github.com/espressif/esp-toolchain-docs/blob/main/qemu/README.md) lists S3 dual cores, flash, OPI PSRAM, interrupts and GDMA, but marks general-purpose SPI, I²C, I²S and the GPIO matrix unsupported. Its framebuffer is a virtual device, not a CO5300. Consequently the stock 1.75C BSP cannot be presumed to initialize display, touch, PMIC, IMU or audio on QEMU without significant models or firmware adaptation.

The current shared diagnostic firmware now renders and responds to a simulated tap in esp32sim. QEMU remains a candidate for an independent reduced serial-only ESP-IDF baseline; it has not been tested with this firmware. Espressif also publishes [esp-emulator](https://github.com/espressif/esp-emulator) with S3 support; its 1.75C device coverage and suitability remain unverified.

## Minimum validation sequence

1. Pin an emulator version and legally obtain the matching ESP32-S3 ROM. Build a serial-only S3 sample with known IDF/toolchain versions. Supply bootloader, partition table and application at their actual offsets, with an explicit virtual flash size and PSRAM configuration. Capture boot and serial output through FreeRTOS startup and an observable application result.
2. Establish a 1.75C board model with verified reset/interrupt wiring; exercise CO5300 QSPI transactions, framebuffer contents and CST9217 I²C touch reports. Add PMIC power/brightness behavior and IMU data required by the chosen firmware. Implement or explicitly stub optional audio and other peripherals; test IRQ/GPIO behavior and timing assumptions.
3. Compare deterministic input events, display output, serial logs, memory configuration and lifecycle against the same build running on a real, identified 1.75C. Only claim support for the firmware and behaviors actually validated. Do not write or read protected firmware without authorization.
