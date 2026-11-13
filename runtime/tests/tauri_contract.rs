#![cfg(feature = "tauri-commands")]
use amoled_runtime::tauri_commands;

// Compile-checks that a separate Tauri host can register the public command wrappers.
#[allow(dead_code)]
fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        tauri_commands::get_board_profile,
        tauri_commands::get_default_firmware_images,
        tauri_commands::start_runtime,
        tauri_commands::stop_runtime,
        tauri_commands::get_runtime_status,
        tauri_commands::get_runtime_logs,
        tauri_commands::capture_framebuffer,
        tauri_commands::send_touch,
    ])
}
