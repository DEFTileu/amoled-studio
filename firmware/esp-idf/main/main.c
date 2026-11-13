#include "app.h"
#include "bsp/esp-bsp.h"
#include "bsp/display.h"
#include "esp_log.h"
#include "esp_err.h"

void app_main(void) {
    if (bsp_display_start() == NULL) {
        ESP_LOGE("studio", "1.75C display startup failed");
        return;
    }
    if (bsp_display_lock(-1) != ESP_OK) {
        ESP_LOGE("studio", "LVGL lock failed");
        return;
    }
    studio_app_init(NULL);
    ESP_LOGI("studio", "AMOLED_FIRMWARE_LVGL_READY");
    bsp_display_unlock();
}
