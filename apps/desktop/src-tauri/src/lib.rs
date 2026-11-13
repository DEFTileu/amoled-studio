mod frames;

use amoled_runtime::{tauri_commands, RuntimeManager};
use std::{path::PathBuf, sync::Arc};
use tauri::{Manager, RunEvent};

/// Directory the runtime resolves `build/`, `.tools/` and `firmware/` against.
/// AMOLED_PROJECT_ROOT overrides; a packaged app uses Resources/studio-root (see tauri.release.conf.json); dev builds use the repo.
fn project_root(app: &tauri::AppHandle) -> PathBuf {
    if let Some(root) = std::env::var_os("AMOLED_PROJECT_ROOT") { return PathBuf::from(root); }
    // Only inside a real bundle: a studio-root left beside a dev binary by `tauri build` must not shadow the repo.
    let in_bundle = std::env::current_exe().ok().is_some_and(|e| e.parent().is_some_and(|d| d.ends_with("Contents/MacOS")));
    if let Some(bundled) = in_bundle.then(|| app.path().resource_dir().ok()).flatten().map(|d| d.join("studio-root")).filter(|d| d.is_dir()) { return bundled; }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// Debug-only self-test hook: evaluates AMOLED_STUDIO_E2E=<script.js> inside the real webview and lets it write result files
/// to AMOLED_STUDIO_E2E_OUT. Not compiled into release builds; inert unless both variables are set.
#[cfg(debug_assertions)]
mod e2e {
    use std::{fs, path::PathBuf, time::Duration};
    use tauri::{AppHandle, Manager};

    #[tauri::command]
    pub fn e2e_write(name: String, text: String) -> Result<(), String> {
        let dir = PathBuf::from(std::env::var_os("AMOLED_STUDIO_E2E_OUT").ok_or("e2e disabled")?);
        if name.contains('/') || name.contains("..") { return Err("bad name".into()); }
        fs::create_dir_all(&dir).and_then(|_| fs::write(dir.join(name), text)).map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn e2e_exit(app: AppHandle) { app.exit(0); }

    pub fn spawn(app: &AppHandle) {
        let Some(script) = std::env::var_os("AMOLED_STUDIO_E2E") else { return };
        let Ok(src) = fs::read_to_string(&script) else { eprintln!("e2e: cannot read {script:?}"); return };
        let home = std::env::var("HOME").unwrap_or_default();
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(3)); // let the page load and React mount
            if let Some(w) = app.get_webview_window("main") {
                // A backgrounded WKWebView throttles timers and rAF, which would stall the script.
                let _ = w.show();
                let _ = w.set_focus();
                let _ = w.eval(&format!("window.__E2E__={{home:{home:?}}};\n{src}"));
            }
        });
    }
}

macro_rules! handlers {
    ($($extra:path),*) => {
        tauri::generate_handler![
            tauri_commands::get_board_profile,
            tauri_commands::get_default_firmware_images,
            tauri_commands::start_runtime,
            tauri_commands::stop_runtime,
            tauri_commands::get_runtime_status,
            tauri_commands::get_runtime_logs,
            tauri_commands::capture_framebuffer,
            tauri_commands::send_touch,
            frames::subscribe_frames,
            frames::unsubscribe_frames,
            $($extra),*
        ]
    };
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(frames::Subscriptions::default())
        .setup(|app| {
            let manager = RuntimeManager::new_private(project_root(app.handle()))
                .map_err(std::io::Error::other)?;
            app.manage(Arc::new(manager));
            #[cfg(debug_assertions)]
            e2e::spawn(app.handle());
            Ok(())
        })
        .invoke_handler({
            #[cfg(debug_assertions)] { handlers!(e2e::e2e_write, e2e::e2e_exit) }
            #[cfg(not(debug_assertions))] { handlers!() }
        })
        .build(tauri::generate_context!())
        .expect("failed to build AMOLED Studio")
        .run(|app, event| {
            // runtime/README.md: the host must stop the supervised child on shutdown.
            if let RunEvent::Exit = event {
                if let Some(manager) = app.try_state::<Arc<RuntimeManager>>() { let _ = manager.stop(); }
            }
        });
}
