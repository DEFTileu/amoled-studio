#ifndef STUDIO_BOARD_H
#define STUDIO_BOARD_H
#include <stdint.h>
typedef struct {
    const char *id, *name, *display, *touch, *imu, *pmic, *rtc, *audio, *flash_notes;
    uint16_t width, height;
    uint8_t flash_mb, psram_mb; /* flash_mb == 0 means unconfirmed */
    int lcd_d0, lcd_d1, lcd_d2, lcd_d3, lcd_clk, lcd_cs, lcd_reset;
    int touch_sda, touch_scl, touch_interrupt, touch_reset;
    int audio_mclk, audio_bclk, audio_ws, audio_dout, audio_din, audio_amp;
} studio_board_profile;
const studio_board_profile *studio_board_175c(void);
#endif
