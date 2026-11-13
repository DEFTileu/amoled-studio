#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/i2c_master.h"
#include "esp_err.h"

void app_main(void) {
    puts("AMOLED_STUDIO_EMU_BOOT_OK");
    i2c_master_bus_handle_t bus = NULL;
    i2c_master_dev_handle_t device = NULL;
    i2c_master_bus_config_t bus_cfg = { .i2c_port = I2C_NUM_0, .sda_io_num = 15, .scl_io_num = 14,
        .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7, .flags.enable_internal_pullup = true };
    i2c_device_config_t dev_cfg = { .dev_addr_length = I2C_ADDR_BIT_LEN_7, .device_address = 0x5a, .scl_speed_hz = 100000 };
    esp_err_t result = i2c_new_master_bus(&bus_cfg, &bus);
    if (result == ESP_OK) result = i2c_master_bus_add_device(bus, &dev_cfg, &device);
    uint8_t address[2] = {0xd1, 0xf8}, value[4] = {0};
    if (result == ESP_OK) result = i2c_master_transmit_receive(device, address, sizeof(address), value, sizeof(value), 1000);
    if (result == ESP_OK && value[0] == 0xd2 && value[1] == 1 && value[2] == 0xd2 && value[3] == 1)
        puts("AMOLED_STUDIO_CST9217_OK");
    else printf("AMOLED_STUDIO_CST9217_FAIL err=%s bytes=%02x%02x%02x%02x\n", esp_err_to_name(result), value[0], value[1], value[2], value[3]);
    fflush(stdout);
    vTaskDelay(pdMS_TO_TICKS(600));
    puts("AMOLED_STUDIO_DELAY_OK");
    while (1) vTaskDelay(pdMS_TO_TICKS(1000));
}
