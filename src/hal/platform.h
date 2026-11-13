#ifndef STUDIO_PLATFORM_H
#define STUDIO_PLATFORM_H
#include <stdbool.h>
#include <stdint.h>
typedef struct { float accel_g[3]; float gyro_dps[3]; } studio_imu;
typedef struct { int16_t x, y; bool pressed; } studio_touch;
typedef struct {
    void *ctx;
    bool (*display_init)(void *ctx);
    bool (*input_read)(void *ctx, studio_touch *touch);
    uint64_t (*time_ms)(void *ctx);
    int (*battery_percent)(void *ctx);
    studio_imu (*imu)(void *ctx);
    bool (*set_brightness)(void *ctx, unsigned percent);
    void (*shutdown)(void *ctx);
} studio_platform;
#endif
