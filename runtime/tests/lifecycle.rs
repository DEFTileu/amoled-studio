use amoled_runtime::{FirmwareImages, RuntimeConfig, RuntimeKind, RuntimeManager, State};
use std::path::PathBuf;

#[test]
fn rejects_invalid_flash_and_missing_images() {
    let manager = RuntimeManager::new(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf(),
    );
    let config = RuntimeConfig::Firmware {
        flash_mb: 8,
        psram_mb: 8,
        images: FirmwareImages::default(),
    };
    assert!(manager.start(config).is_err());
    assert_eq!(manager.status().state, State::Stopped);
    let config = RuntimeConfig::Firmware {
        flash_mb: 16,
        psram_mb: 8,
        images: FirmwareImages::default(),
    };
    assert!(manager.start(config).is_err());
}

#[test]
fn stop_is_idempotent_and_initial_state_is_empty() {
    let manager = RuntimeManager::new(PathBuf::from("."));
    assert_eq!(manager.status().state, State::Stopped);
    assert_eq!(manager.status().kind, None::<RuntimeKind>);
    manager.stop().unwrap();
    manager.stop().unwrap();
}

#[test]
fn installation_validation_reports_missing_runtime_assets() {
    let root = tempfile::tempdir().unwrap();
    let manager = RuntimeManager::new(root.path().to_path_buf());
    assert!(manager
        .validate_installation()
        .unwrap_err()
        .contains("amoled-simulator"));
}

#[test]
fn private_desktop_frame_relay_uses_supervisor_credentials() {
    use std::{
        thread,
        time::{Duration, Instant},
    };
    if std::env::var("STUDIO_RUNTIME_E2E").as_deref() != Ok("1") {
        return;
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let manager = RuntimeManager::new_private(root).unwrap();
    let status = manager
        .start(RuntimeConfig::Firmware {
            flash_mb: 16,
            psram_mb: 8,
            images: manager.default_firmware_images(),
        })
        .unwrap();
    assert!(status.viewer_url.is_none());
    let deadline = Instant::now() + Duration::from_secs(15);
    while !manager
        .logs()
        .iter()
        .any(|x| x.message.contains("AMOLED_FIRMWARE_LVGL_READY"))
    {
        assert!(
            Instant::now() < deadline,
            "firmware initialization timed out"
        );
        thread::sleep(Duration::from_millis(50));
    }
    let mut stream = manager.connect_frame_stream().unwrap();
    loop {
        if let tungstenite::Message::Binary(frame) = stream.read().unwrap() {
            assert_eq!(frame.first(), Some(&1));
            break;
        }
    }
    manager.stop().unwrap();
}

#[cfg(unix)]
#[test]
fn lifecycle_detects_crash_and_restarts() {
    use std::{
        fs,
        os::unix::fs::PermissionsExt,
        thread,
        time::{Duration, Instant},
    };
    let root = std::env::temp_dir().join(format!("amoled-runtime-{}", std::process::id()));
    fs::create_dir_all(root.join("build")).unwrap();
    let path = root.join("build/amoled-simulator");
    fs::write(
        &path,
        "#!/bin/sh\necho runtime-started\nsleep 0.1\necho runtime-crash >&2\nexit 7\n",
    )
    .unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    let manager = RuntimeManager::new(root.clone());
    let cfg = || RuntimeConfig::Simulator {
        battery_percent: 50,
        brightness_percent: 50,
        accel_x: 0.0,
        time_ms: 0,
    };
    assert_eq!(manager.start(cfg()).unwrap().state, State::Running);
    assert!(manager.start(cfg()).is_err());
    let deadline = Instant::now() + Duration::from_secs(3);
    while manager.status().state == State::Running && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    let status = manager.status();
    assert_eq!(status.state, State::Failed);
    assert_eq!(status.exit_code, Some(7));
    thread::sleep(Duration::from_millis(50));
    assert!(manager.logs().iter().any(|x| x.message == "runtime-crash"));
    assert_eq!(manager.start(cfg()).unwrap().state, State::Running);
    assert_eq!(manager.stop().unwrap().state, State::Stopped);
    drop(manager);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn real_firmware_frame_and_touch() {
    use amoled_runtime::{TouchAction, TouchRequest};
    use std::{
        thread,
        time::{Duration, Instant},
    };
    if std::env::var("STUDIO_RUNTIME_E2E").as_deref() != Ok("1") {
        return;
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let build = root.join("firmware/esp-idf/build");
    let images = FirmwareImages {
        bootloader: build.join("bootloader/bootloader.bin"),
        partition_table: build.join("partition_table/partition-table.bin"),
        app: build.join("amoled_studio_175c.bin"),
        elf: Some(build.join("amoled_studio_175c.elf")),
    };
    let manager = RuntimeManager::new(root);
    assert!(manager.snapshot().is_err());
    std::env::set_var("SDL_VIDEODRIVER", "dummy");
    std::env::set_var("SDL_RENDER_DRIVER", "software");
    manager
        .start(RuntimeConfig::Simulator {
            battery_percent: 73,
            brightness_percent: 50,
            accel_x: 0.25,
            time_ms: 100,
        })
        .unwrap();
    thread::sleep(Duration::from_millis(250));
    assert_eq!(
        manager.status().state,
        State::Running,
        "SDL simulator failed: {:?}",
        manager.logs()
    );
    manager.stop().unwrap();
    let status = manager
        .start(RuntimeConfig::Firmware {
            flash_mb: 16,
            psram_mb: 8,
            images,
        })
        .unwrap();
    assert_eq!(status.state, State::Running);
    assert!(status.viewer_url.is_some());
    let deadline = Instant::now() + Duration::from_secs(15);
    while !manager
        .logs()
        .iter()
        .any(|x| x.message.contains("AMOLED_FIRMWARE_LVGL_READY"))
        && Instant::now() < deadline
    {
        thread::sleep(Duration::from_millis(50));
    }
    assert!(
        manager
            .logs()
            .iter()
            .any(|x| x.message.contains("AMOLED_FIRMWARE_LVGL_READY")),
        "firmware not ready: {:?}",
        manager.logs()
    );
    thread::sleep(Duration::from_millis(150));
    let before = manager.snapshot().unwrap();
    assert_eq!((before.width, before.height), (466, 466));
    assert!(manager
        .touch(TouchRequest {
            action: TouchAction::Move,
            x: 234,
            y: 264
        })
        .is_err());
    manager
        .touch(TouchRequest {
            action: TouchAction::Press,
            x: 234,
            y: 264,
        })
        .unwrap();
    thread::sleep(Duration::from_millis(200));
    manager
        .touch(TouchRequest {
            action: TouchAction::Release,
            x: 234,
            y: 264,
        })
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !manager
        .logs()
        .iter()
        .any(|x| x.message.contains("AMOLED_FIRMWARE_SCREEN_1"))
        && Instant::now() < deadline
    {
        thread::sleep(Duration::from_millis(50));
    }
    assert!(
        manager
            .logs()
            .iter()
            .any(|x| x.message.contains("AMOLED_FIRMWARE_SCREEN_1")),
        "tap not received: {:?}",
        manager.logs()
    );
    thread::sleep(Duration::from_millis(200));
    let after = manager.snapshot().unwrap();
    assert_ne!(before.data_base64, after.data_base64);
    manager
        .touch(TouchRequest {
            action: TouchAction::Press,
            x: 320,
            y: 110,
        })
        .unwrap();
    for x in (120..=300).rev().step_by(20) {
        thread::sleep(Duration::from_millis(10));
        manager
            .touch(TouchRequest {
                action: TouchAction::Move,
                x,
                y: 110,
            })
            .unwrap();
    }
    thread::sleep(Duration::from_millis(100));
    manager
        .touch(TouchRequest {
            action: TouchAction::Release,
            x: 120,
            y: 110,
        })
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !manager
        .logs()
        .iter()
        .any(|x| x.message.contains("AMOLED_FIRMWARE_SCREEN_0"))
        && Instant::now() < deadline
    {
        thread::sleep(Duration::from_millis(50));
    }
    assert!(
        manager
            .logs()
            .iter()
            .any(|x| x.message.contains("AMOLED_FIRMWARE_SCREEN_0")),
        "swipe not received: {:?}",
        manager.logs()
    );
    assert_eq!(manager.stop().unwrap().state, State::Stopped);
    assert!(manager.snapshot().is_err());
}

#[test]
fn firmware_validation_rejects_non_esp_images() {
    use std::fs;
    let root = std::env::temp_dir().join(format!("amoled-invalid-{}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    let image = root.join("bad.bin");
    fs::write(&image, [0u8; 64]).unwrap();
    let manager = RuntimeManager::new(root.clone());
    let images = FirmwareImages {
        bootloader: image.clone(),
        partition_table: image.clone(),
        app: image,
        elf: None,
    };
    let err = manager
        .start(RuntimeConfig::Firmware {
            flash_mb: 16,
            psram_mb: 8,
            images,
        })
        .unwrap_err();
    assert!(err.contains("not an ESP image"));
    assert_eq!(manager.status().state, State::Stopped);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn drop_terminates_and_reaps_simulator_child() {
    use std::{fs, os::unix::fs::PermissionsExt, process::Command};
    let root = std::env::temp_dir().join(format!("amoled-cleanup-{}", std::process::id()));
    fs::create_dir_all(root.join("build")).unwrap();
    let path = root.join("build/amoled-simulator");
    fs::write(&path, "#!/bin/sh\nexec sleep 30\n").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    let manager = RuntimeManager::new(root.clone());
    let config = || RuntimeConfig::Simulator {
        battery_percent: 50,
        brightness_percent: 50,
        accel_x: 0.0,
        time_ms: 0,
    };
    let first = manager.start(config()).unwrap().pid.unwrap();
    manager.stop().unwrap();
    let second = manager.start(config()).unwrap().pid.unwrap();
    assert_ne!(first, second);
    drop(manager);
    let alive = Command::new("/bin/kill")
        .args(["-0", &second.to_string()])
        .output()
        .unwrap()
        .status
        .success();
    assert!(!alive, "child {second} survived manager drop");
    fs::remove_dir_all(root).unwrap();
}
