#include "lvgl.h"
#include "app.h"
#include "circle.h"
#include "board.h"
#include "mock_platform.h"
#include <SDL.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <errno.h>
#include <math.h>
#include <inttypes.h>

#define SIZE 466
static SDL_Window *window;
static SDL_Renderer *renderer;
static SDL_Texture *texture;
static uint32_t pixels[SIZE * SIZE];
static uint32_t draw_buffer[SIZE * 40];
static int mouse_x, mouse_y;
static bool pressed;
static bool round_mask = true;
static bool render_error;

static void flush(lv_display_t *display, const lv_area_t *area, uint8_t *data) {
    const uint32_t *source = (const uint32_t *)data;
    for (int y = area->y1; y <= area->y2; ++y) {
        for (int x = area->x1; x <= area->x2; ++x) {
            uint32_t color = *source++;
            if (x >= 0 && y >= 0 && x < SIZE && y < SIZE)
                pixels[y * SIZE + x] = (!round_mask || circle_contains(x, y)) ? color : 0xff000000u;
        }
    }
    if (SDL_UpdateTexture(texture, NULL, pixels, SIZE * sizeof(uint32_t)) != 0 ||
        SDL_RenderClear(renderer) != 0 || SDL_RenderCopy(renderer, texture, NULL, NULL) != 0) {
        fprintf(stderr, "SDL rendering failed: %s\n", SDL_GetError());
        render_error = true;
    } else SDL_RenderPresent(renderer);
    lv_display_flush_ready(display);
}
static void read_pointer(lv_indev_t *indev, lv_indev_data_t *data) {
    (void)indev;
    data->point.x = mouse_x;
    data->point.y = mouse_y;
    data->state = pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}
static void handle_event(const SDL_Event *event, lv_indev_t *input, bool *running) {
    if (event->type == SDL_QUIT) *running = false;
    if (event->type == SDL_MOUSEMOTION) {
        mouse_x = event->motion.x; mouse_y = event->motion.y;
        if (pressed) lv_indev_read(input);
    }
    if (event->type == SDL_MOUSEBUTTONDOWN && event->button.button == SDL_BUTTON_LEFT) {
        mouse_x = event->button.x; mouse_y = event->button.y;
        pressed = !round_mask || circle_contains(mouse_x, mouse_y);
        lv_indev_read(input);
    }
    if (event->type == SDL_MOUSEBUTTONUP && event->button.button == SDL_BUTTON_LEFT) {
        mouse_x = event->button.x; mouse_y = event->button.y; pressed = false;
        lv_indev_read(input);
    }
}
static void cleanup(void) {
    if (texture) SDL_DestroyTexture(texture);
    if (renderer) SDL_DestroyRenderer(renderer);
    if (window) SDL_DestroyWindow(window);
    SDL_Quit();
}
static bool parse_unsigned_env(const char *name, uint64_t max, uint64_t *out) {
    const char *value = getenv(name); if (!value) return true;
    if (!*value || *value == '-') return false;
    char *end; errno = 0; unsigned long long parsed = strtoull(value, &end, 10);
    if (errno || *end || parsed > max) return false;
    *out = parsed; return true;
}
static bool load_mock_config(studio_mock_config *config) {
    uint64_t battery = (uint64_t)config->battery_percent, brightness = config->brightness_percent;
    if (!parse_unsigned_env("STUDIO_BATTERY", 100, &battery) ||
        !parse_unsigned_env("STUDIO_BRIGHTNESS", 100, &brightness) ||
        !parse_unsigned_env("STUDIO_TIME_MS", UINT64_MAX, &config->time_ms)) return false;
    config->battery_percent = (int)battery; config->brightness_percent = (unsigned)brightness;
    const char *x = getenv("STUDIO_ACCEL_X");
    if (x) { char *end; errno = 0; float value = strtof(x, &end);
        if (errno || end == x || *end || !isfinite(value)) return false;
        config->imu.accel_g[0] = value;
    }
    return true;
}
int main(int argc, char **argv) {
    bool smoke = false, gesture_smoke = false, boundary_smoke = false;
    int expected_mask = -1;
    for (int i = 1; i < argc; ++i) {
        if (!strcmp(argv[i], "--smoke")) smoke = true;
        else if (!strcmp(argv[i], "--gesture-smoke")) { smoke = true; gesture_smoke = true; }
        else if (!strcmp(argv[i], "--boundary-smoke")) { smoke = true; boundary_smoke = true; }
        else if (!strcmp(argv[i], "--round")) round_mask = true;
        else if (!strcmp(argv[i], "--square")) round_mask = false;
        else if (!strcmp(argv[i], "--expect-round")) expected_mask = 1;
        else if (!strcmp(argv[i], "--expect-square")) expected_mask = 0;
        else { fprintf(stderr, "Usage: %s [--round|--square] [--smoke|--gesture-smoke]\n", argv[0]); return 2; }
    }
    studio_mock_config config = studio_mock_defaults(); studio_mock_platform mock;
    if (!load_mock_config(&config) || !studio_mock_init(&mock, &config)) {
        fprintf(stderr, "Invalid simulator mock configuration\n"); return 2;
    }
    printf("%s battery=%d brightness=%u accel_x=%.2f time_ms=%" PRIu64 "\n", studio_board_175c()->id,
        mock.platform.battery_percent(mock.platform.ctx), config.brightness_percent,
        (double)mock.platform.imu(mock.platform.ctx).accel_g[0], mock.platform.time_ms(mock.platform.ctx));
    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER) != 0) { fprintf(stderr, "SDL init: %s\n", SDL_GetError()); return 1; }
    window = SDL_CreateWindow("AMOLED Studio Simulator", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, SIZE, SIZE, 0);
    if (window) renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_SOFTWARE);
    if (renderer) texture = SDL_CreateTexture(renderer, SDL_PIXELFORMAT_ARGB8888, SDL_TEXTUREACCESS_STREAMING, SIZE, SIZE);
    if (!window || !renderer || !texture) { fprintf(stderr, "SDL display: %s\n", SDL_GetError()); cleanup(); return 1; }
    lv_init();
    lv_tick_set_cb(SDL_GetTicks);
    lv_display_t *display = lv_display_create(SIZE, SIZE);
    if (!display) { fprintf(stderr, "LVGL display allocation failed\n"); cleanup(); return 1; }
    lv_display_set_color_format(display, LV_COLOR_FORMAT_ARGB8888);
    lv_display_set_buffers(display, draw_buffer, NULL, sizeof(draw_buffer), LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(display, flush);
    lv_indev_t *input = lv_indev_create();
    if (!input) { fprintf(stderr, "LVGL input allocation failed\n"); lv_deinit(); cleanup(); return 1; }
    lv_indev_set_type(input, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(input, read_pointer);
    studio_app_init(&mock.platform);
    bool running = true;
    int result = 0;
    if (smoke) {
        /* Exercise LVGL's real pointer reader and button dispatch. */
        lv_obj_t *first = lv_screen_active();
        lv_refr_now(display);
        if (expected_mask >= 0 && ((pixels[0] == 0xff000000u) != expected_mask)) {
            fprintf(stderr, "Smoke: unexpected display mask\n"); result = 1;
        }
        if ((round_mask && pixels[0] != 0xff000000u) || (!round_mask && pixels[0] == 0xff000000u) || pixels[233 * SIZE + 233] == 0xff000000u) {
            fprintf(stderr, "Smoke: circular rendering failed\n"); result = 1;
        }
        SDL_Event click = {0};
        if (boundary_smoke) {
            click.type = SDL_MOUSEBUTTONDOWN; click.button.button = SDL_BUTTON_LEFT;
            click.button.x = 0; click.button.y = 0;
            handle_event(&click, input, &running);
            if (pressed) { fprintf(stderr, "Smoke: press outside circle accepted\n"); result = 1; }
            click.type = SDL_MOUSEBUTTONUP;
            handle_event(&click, input, &running);
        }
        if (gesture_smoke) {
            click.type = SDL_MOUSEBUTTONDOWN; click.button.button = SDL_BUTTON_LEFT;
            click.button.x = 320; click.button.y = 110;
            handle_event(&click, input, &running);
            for (int x = 310; x >= 120; x -= 10) {
                SDL_Event move = {0}; move.type = SDL_MOUSEMOTION; move.motion.x = x; move.motion.y = 110;
                handle_event(&move, input, &running);
            }
            click.type = SDL_MOUSEBUTTONUP; click.button.x = 120;
            handle_event(&click, input, &running);
            if (lv_screen_active() == first) {
                fprintf(stderr, "Smoke: left swipe did not switch screens\n"); result = 1;
            } else {
                click.type = SDL_MOUSEBUTTONDOWN; click.button.x = 120;
                handle_event(&click, input, &running);
                for (int x = 130; x <= 320; x += 10) {
                    SDL_Event move = {0}; move.type = SDL_MOUSEMOTION; move.motion.x = x; move.motion.y = 110;
                    handle_event(&move, input, &running);
                }
                click.type = SDL_MOUSEBUTTONUP; click.button.x = 320;
                handle_event(&click, input, &running);
                if (lv_screen_active() != first) {
                    fprintf(stderr, "Smoke: right swipe did not return to first screen\n"); result = 1;
                }
            }
        } else {
        click.type = SDL_MOUSEBUTTONDOWN; click.button.button = SDL_BUTTON_LEFT;
        click.button.x = 233; click.button.y = 263;
        if (SDL_PushEvent(&click) != 1) { fprintf(stderr, "Smoke: SDL push failed: %s\n", SDL_GetError()); result = 1; }
        click.type = SDL_MOUSEBUTTONUP;
        if (SDL_PushEvent(&click) != 1) { fprintf(stderr, "Smoke: SDL push failed: %s\n", SDL_GetError()); result = 1; }
        SDL_Event event;
        while (SDL_PollEvent(&event)) handle_event(&event, input, &running);
        }
        if (!gesture_smoke && lv_screen_active() == first) {
            fprintf(stderr, "Smoke: pointer click did not switch screens\n"); result = 1;
        }
    }
    uint32_t start = SDL_GetTicks();
    while (running) {
        SDL_Event event;
        while (SDL_PollEvent(&event)) handle_event(&event, input, &running);
        lv_timer_handler();
        if (smoke && SDL_GetTicks() - start >= 250) running = false;
        SDL_Delay(5);
    }
    lv_deinit();
    cleanup();
    return result || render_error ? 1 : 0;
}
