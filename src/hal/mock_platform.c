#include "mock_platform.h"
#include <stddef.h>
#include <math.h>
static bool display_init(void *ctx) { return ctx != NULL; }
static bool input_read(void *ctx, studio_touch *out) { if (!ctx || !out) return false; *out = ((studio_mock_platform *)ctx)->config.touch; return true; }
static uint64_t time_ms(void *ctx) { return ((studio_mock_platform *)ctx)->config.time_ms; }
static int battery(void *ctx) { return ((studio_mock_platform *)ctx)->config.battery_percent; }
static studio_imu imu(void *ctx) { return ((studio_mock_platform *)ctx)->config.imu; }
static bool brightness(void *ctx, unsigned value) { if (value > 100) return false; ((studio_mock_platform *)ctx)->config.brightness_percent = value; return true; }
static void shutdown_platform(void *ctx) { (void)ctx; }
studio_mock_config studio_mock_defaults(void) { studio_mock_config c = { .battery_percent = 100, .brightness_percent = 100, .imu = { .accel_g = { 0, 0, 1 } } }; return c; }
bool studio_mock_init(studio_mock_platform *mock, const studio_mock_config *config) {
    if (!mock || !config || config->battery_percent < 0 || config->battery_percent > 100 || config->brightness_percent > 100) return false;
    for (unsigned i = 0; i < 3; i++) if (!isfinite(config->imu.accel_g[i]) || !isfinite(config->imu.gyro_dps[i])) return false;
    mock->config = *config;
    mock->platform = (studio_platform){mock, display_init, input_read, time_ms, battery, imu, brightness, shutdown_platform};
    return true;
}
