#include "board.h"
#include "mock_platform.h"
#include <assert.h>
#include <string.h>
int main(void) {
    const studio_board_profile *b = studio_board_175c();
    assert(strcmp(b->id, "waveshare-esp32-s3-touch-amoled-1.75c") == 0);
    assert(b->width == 466 && b->height == 466 && b->flash_mb == 0 && b->psram_mb == 8);
    assert(strstr(b->flash_notes, "16 MB") && strstr(b->flash_notes, "32 MB"));
    assert(b->lcd_reset == 1 && b->touch_reset == 2 && b->audio_mclk == 16);
    studio_mock_config c = studio_mock_defaults();
    c.battery_percent = 37; c.imu.accel_g[0] = 1.25f; c.time_ms = 42000; c.brightness_percent = 42;
    studio_mock_platform mock;
    assert(studio_mock_init(&mock, &c));
    studio_platform *p = &mock.platform;
    assert(p->display_init(p->ctx));
    c.touch = (studio_touch){12, 34, true};
    mock.config.touch = c.touch;
    studio_touch touch = {0};
    assert(p->input_read(p->ctx, &touch));
    assert(touch.x == 12 && touch.y == 34 && touch.pressed);
    assert(!p->input_read(p->ctx, NULL));
    assert(p->battery_percent(p->ctx) == 37);
    assert(p->imu(p->ctx).accel_g[0] == 1.25f);
    assert(p->time_ms(p->ctx) == 42000);
    assert(p->set_brightness(p->ctx, 80));
    assert(mock.config.brightness_percent == 80);
    assert(!p->set_brightness(p->ctx, 101));
    assert(mock.config.brightness_percent == 80);
    p->shutdown(p->ctx);
    c.battery_percent = 101;
    assert(!studio_mock_init(&mock, &c));
    return 0;
}
