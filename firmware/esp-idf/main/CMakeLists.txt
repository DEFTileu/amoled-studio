idf_component_register(SRCS "main.c" "../../../src/app/app.c"
    INCLUDE_DIRS "../../../src/app" "../../../src/hal"
    REQUIRES lvgl__lvgl waveshare__esp32_s3_touch_amoled_1_75c)
