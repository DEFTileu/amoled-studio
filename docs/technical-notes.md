# 1.75C engineering notes

The only supported target profile is `waveshare-esp32-s3-touch-amoled-1.75c`. The profile type permits future additions, but there are no other profiles. The profile records the following board-specific information, checked against Waveshare's [1.75C repository](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C), [1.75C schematic](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C/blob/4bfdc80eedbf95031e384610796bed15e0240312/hardware/schematic/ESP32-S3-Touch-AMOLED-1.75C-schematic.pdf), and [Arduino pin configuration](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C/blob/4bfdc80eedbf95031e384610796bed15e0240312/examples/arduino/libraries/board_config/pin_config.h).

| Function | 1.75C evidence |
| --- | --- |
| MCU / PSRAM | ESP32-S3R8, 8 MB PSRAM; Waveshare example configures octal PSRAM. |
| Flash | **Unresolved**: the repository overview says 32 MB, its ESP-IDF example selects 32 MB, and the documentation's onboard-resources list says 32 MB. The same product documentation's feature text and Arduino CI say 16 MB; the schematic labels the flash XM25QH128DHIQT. The profile uses 0 for unknown capacity and records both claims. Verify the actual device and fitted revision before selecting partitions or writing firmware. |
| Display | 466 × 466 CO5300 QSPI; D0–D3 GPIO4/5/6/7, clock 38, CS 12, reset 1. The [Waveshare product page](https://www.waveshare.com/esp32-s3-touch-amoled-1.75c.htm) explicitly identifies a round display. The 1.75C repository README calls it square; we use the product description for the visible glass and retain a square logical-framebuffer preview. |
| Touch | CST9217, I²C SDA 15 / SCL 14, interrupt 11, reset 2. |
| IMU / PMIC | QMI8658 and AXP2101. |
| RTC | No standalone RTC was identified in the inspected 1.75C schematic or official example list. The AXP2101 RTC supply names alone do not establish a discrete RTC. Treat availability and type as unconfirmed. |
| Audio | ES8311 output and ES7210 input with two microphones; I²S MCLK 16, BCLK 9, WS 45, DOUT 8, DIN 10, amplifier control 46. |

The schematic and repository can change; verify the board revision and all peripheral connections before using board-facing code. No hardware tests have been performed.

## Safe flash-capacity identification

The schematic labels the flash XM25QH128DHIQT, which Waveshare identifies as a 128-Mbit / 16-MB part in [another official hardware reference](https://github.com/waveshareteam/ESP32-S3-CAN-2CH/blob/main/HARDWARE_REFERENCE.md). This is evidence about the schematic, not proof of the chip fitted to a particular board. The product page and the 1.75C ESP-IDF example indicate 32 MB; the product documentation feature text and Arduino CI indicate 16 MB. The product documentation also mentions an RTC without identifying a separate part; its type and availability remain unverified.

To identify a particular board without writing flash:

1. Connect only the intended board and close serial monitors. List ports with `ls /dev/cu.*`; identify the board's USB serial port by comparing before and after connection. Do not assume any port is the board.
2. Activate a working ESP-IDF environment, then run `python -m esptool --chip esp32s3 --port /dev/cu.<BOARD_PORT> flash-id` with the identified port. This reads the JEDEC ID and reports the detected capacity. It can reset the device, interrupt its running firmware, and temporarily load a RAM stub; it does not erase or program flash. Boot/download mode may require the board's BOOT procedure.
3. Record the manufacturer/device ID, reported size, board revision and schematic/part marking; investigate mismatches rather than silently choosing a size. Reset the board normally after the read if needed. Never run `write-flash`, `erase-flash`, or `idf.py flash` as part of identification.

This procedure is based on [Espressif's esptool flash-id documentation](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/basic-commands.html#read-spi-flash-id-flash-id). It has not been run against a board in this session.

## ESP-IDF build

`firmware/esp-idf` uses the official `waveshare/esp32_s3_touch_amoled_1_75c` BSP 3.0.0 and LVGL 9.3.0 with the shared test app. The [official 1.75C example](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C/blob/4bfdc80eedbf95031e384610796bed15e0240312/examples/esp-idf/02_lvgl_demo_v9/main/main.c) is the integration reference. The available local ESP-IDF 6.1 built the project successfully; Waveshare lists 5.5.5 and 6.0.2 for its own examples, so 6.1 is outside that tested matrix. Component-manager resolutions are recorded in `firmware/esp-idf/dependencies.lock`.

```sh
source "$HOME/esp/esp-idf/export.sh" # or export your own ESP-IDF installation
idf.py -C firmware/esp-idf set-target esp32s3 build
idf.py -C firmware/esp-idf size
```

**Compile check only:** the generated configuration selected a generic 2 MB flash size and single-app partition table. Neither is a verified 1.75C configuration. Do not flash these binaries. Display, touch, PSRAM and startup have not been tested on hardware; the BSP now starts and renders the diagnostic app in esp32sim. Flashing requires explicit user approval after the actual capacity, board revision and partition scheme are verified.

## Desktop API and emulation

No Tauri commands or firmware emulator are implemented. See [emulation feasibility](emulation-feasibility.md) for the engine comparison and missing device models.
