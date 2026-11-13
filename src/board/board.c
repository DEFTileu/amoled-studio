#include "board.h"
static const studio_board_profile board = {
    .id = "waveshare-esp32-s3-touch-amoled-1.75c", .name = "Waveshare ESP32-S3-Touch-AMOLED-1.75C",
    .display = "CO5300 QSPI", .touch = "CST9217 I2C", .imu = "QMI8658", .pmic = "AXP2101",
    .rtc = "Not confirmed by 1.75C schematic", .flash_notes = "16 MB schematic/CI; 32 MB overview and ESP-IDF example", .audio = "ES8311 output; ES7210 input",
    .width = 466, .height = 466, .flash_mb = 0, .psram_mb = 8,
    .lcd_d0 = 4, .lcd_d1 = 5, .lcd_d2 = 6, .lcd_d3 = 7, .lcd_clk = 38, .lcd_cs = 12, .lcd_reset = 1,
    .touch_sda = 15, .touch_scl = 14, .touch_interrupt = 11, .touch_reset = 2,
    .audio_mclk = 16, .audio_bclk = 9, .audio_ws = 45, .audio_dout = 8, .audio_din = 10, .audio_amp = 46
};
const studio_board_profile *studio_board_175c(void) { return &board; }
