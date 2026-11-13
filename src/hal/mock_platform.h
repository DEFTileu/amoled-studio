#ifndef STUDIO_MOCK_PLATFORM_H
#define STUDIO_MOCK_PLATFORM_H
#include "platform.h"
typedef struct { int battery_percent; uint64_t time_ms; studio_imu imu; unsigned brightness_percent; studio_touch touch; } studio_mock_config;
typedef struct { studio_platform platform; studio_mock_config config; } studio_mock_platform;
studio_mock_config studio_mock_defaults(void);
bool studio_mock_init(studio_mock_platform *mock, const studio_mock_config *config);
#endif
