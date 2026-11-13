#include "app.h"
#include "lvgl.h"
#ifdef ESP_PLATFORM
#include <stdio.h>
#endif

static lv_obj_t *screens[2];
static unsigned current;
static void switch_screen(lv_event_t *event) {
    (void)event;
    current = 1U - current;
    lv_screen_load(screens[current]);
#ifdef ESP_PLATFORM
    printf("AMOLED_FIRMWARE_SCREEN_%u\n", current);
#endif
}
static void gesture(lv_event_t *event) {
    (void)event;
    lv_indev_t *input = lv_indev_active();
    if (input && (lv_indev_get_gesture_dir(input) == LV_DIR_LEFT ||
                  lv_indev_get_gesture_dir(input) == LV_DIR_RIGHT)) switch_screen(event);
}
void studio_app_init(studio_platform *platform) {
    static const char *titles[] = {"Simulator test", "Second screen"};
    for (unsigned i = 0; i < 2; ++i) {
        screens[i] = lv_obj_create(NULL);
        lv_obj_add_event_cb(screens[i], gesture, LV_EVENT_GESTURE, NULL);
        lv_obj_t *label = lv_label_create(screens[i]);
        lv_label_set_text(label, titles[i]);
        lv_obj_align(label, LV_ALIGN_CENTER, 0, -40);
        if (platform && platform->battery_percent) {
            lv_obj_t *status = lv_label_create(screens[i]);
            lv_label_set_text_fmt(status, "Mock battery: %d%%", platform->battery_percent(platform->ctx));
            lv_obj_align(status, LV_ALIGN_CENTER, 0, 100);
        }
        lv_obj_t *button = lv_button_create(screens[i]);
        lv_obj_set_size(button, 140, 50);
        lv_obj_align(button, LV_ALIGN_CENTER, 0, 30);
        lv_obj_add_event_cb(button, switch_screen, LV_EVENT_CLICKED, NULL);
        lv_obj_t *button_label = lv_label_create(button);
        lv_label_set_text(button_label, "Switch screen");
        lv_obj_center(button_label);
    }
    current = 0;
    lv_screen_load(screens[0]);
}
