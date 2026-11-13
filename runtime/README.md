# Runtime integration

For the authenticated universal local HTTP/WebSocket API, see [HTTP_API.md](HTTP_API.md). The Tauri commands below remain available for backward compatibility.

# Desktop runtime API v1

The `amoled-runtime` Rust crate owns at most one direct child process at a time. It supervises the existing native SDL simulator or the real esp32sim firmware emulator; it does not render firmware through host LVGL. Process status is refreshed when queried. A nonzero exit is `failed`; a normal exit is `stopped`; `stop_runtime` kills and reaps the child and is idempotent. Dropping the manager attempts cleanup. Logs are bounded to 500 chunks of at most 4097 bytes, from stdout and stderr. A process that terminates abnormally cannot be automatically cleaned up if the parent is killed uncatchably, and only the direct child is supervised.

## Tauri 2 registration

Use a canonical absolute project root selected by the host application. The crate exposes actual command handlers behind the `tauri-commands` feature, without imposing a frontend or a Tauri app scaffold. Add `amoled-runtime = { path = ".../runtime", features = ["tauri-commands"] }` to the Tauri backend and register the commands in its one `invoke_handler`:

```rust
use amoled_runtime::{RuntimeManager, tauri_commands};
use std::sync::Arc;
// In the host's builder, add:
// .manage(Arc::new(RuntimeManager::new(project_root)))
// .invoke_handler(tauri::generate_handler![
//     tauri_commands::get_board_profile,
//     tauri_commands::get_default_firmware_images,
//     tauri_commands::start_runtime,
//     tauri_commands::stop_runtime,
//     tauri_commands::get_runtime_status,
//     tauri_commands::get_runtime_logs,
//     tauri_commands::capture_framebuffer,
//     tauri_commands::send_touch,
// ])
```

Commands use the serializable structs in the crate; [v1.ts](contracts/v1.ts) mirrors them. `start_runtime` takes `{ config: ... }`; `send_touch` takes `{ request: ... }`; remaining commands take no payload. Errors are returned as strings. Firmware image paths must be absolute; bootloader and application are checked for ESP image magic, and the partition table for a minimum length. This is not full image, partition, chip-target, or cryptographic validation. `get_default_firmware_images` returns paths for this project's BSP build; files must be built before use. `flash_mb` accepts 16 or 32, `psram_mb` currently 8. These are virtual sizes, not claims about physical flash.

The simulator config sets battery, brightness, X acceleration, and fixed mock time **at start**. Firmware mode loads supplied bootloader, partition table, application and optional ELF. Changing config or images requires stop and start. The simulator uses its existing SDL window. There is currently no runtime API to capture its framebuffer or inject its input; `capture_framebuffer` and `send_touch` require firmware mode. Flashing, live sensor mutation, process groups, saved configurations, events/subscriptions, and device communication are not implemented.

## Firmware frames and touch

The supervisor starts esp32sim's own loopback viewer on a dynamically chosen port; `viewer_url` is an existing viewer useful for debugging, not a Desktop Studio design. The port is selected before the emulator binds it, so another local process could take it during the small release/bind window. `running` means process started and viewer port responded, **not** firmware ready: inspect logs for `AMOLED_FIRMWARE_LVGL_READY` or show loading state. Runtime crashes are observed when status or another operation polls the child; there is no push notification.

For integration without the upstream viewer, the emulator's WebSocket at `ws://127.0.0.1:<port>/` emits binary frames: byte `1`, 16-bit little-endian width, 16-bit little-endian height, then little-endian RGB565 pixels. The 1.75C overlay masks pixels outside the round glass to black. `capture_framebuffer` returns one 466 × 466 PNG encoded as base64; it may return an initial black frame before firmware renders. For pointer injection, `send_touch` accepts `press`, zero or more `move`, then `release`, with display-local integer coordinates 0–465. The model converts viewer coordinates to the BSP's mirrored CST9217 coordinates; outside-circle presses are rejected. Await each touch command in order and supply a release after a press, including when the pointer leaves the view. Each API call currently opens a new WebSocket; sustained high-rate input may incur overhead. Avoid sending input from the upstream viewer and the runtime API simultaneously. The potentially blocking Tauri commands run on a blocking worker; the host should coordinate application shutdown with `stop_runtime`.

The viewer listens only on loopback, but other local processes may connect; it is not an authenticated security boundary. Touch and frame timing are simulated, not calibrated to physical hardware. The app must provide an appropriate local content security policy if embedding the loopback viewer.

## Verification

```sh
STUDIO_RUNTIME_E2E=1 cargo test --manifest-path runtime/Cargo.toml
cargo check --manifest-path runtime/Cargo.toml --features tauri-commands --tests
```

The end-to-end test needs the prerequisites and firmware build described in [the firmware emulator guide](../docs/firmware-emulator.md). Without `STUDIO_RUNTIME_E2E=1`, the real-emulator test is skipped. The Tauri adapter is checked as a library; it has not been integrated with a desktop app or packaged for distribution.
