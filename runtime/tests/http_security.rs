use amoled_runtime::http_api::{ApiConfig, ApiServer};
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    time::Duration,
};
use tungstenite::{client::IntoClientRequest, Message};

const TOKEN: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
fn http(addr: SocketAddr, method: &str, path: &str, extra: &str, body: &str) -> (u16, String) {
    let mut s = TcpStream::connect(addr).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
    write!(s, "{method} {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n{extra}Content-Length: {}\r\n\r\n{body}", body.len()).unwrap();
    let mut out = String::new();
    s.read_to_string(&mut out).unwrap();
    (out.split_whitespace().nth(1).unwrap().parse().unwrap(), out)
}
fn auth() -> String {
    format!("Authorization: Bearer {TOKEN}\r\n")
}
fn root() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf()
}

#[test]
fn browser_bootstrap_is_one_time_and_same_origin() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "studio").unwrap();
    let server = rt
        .block_on(ApiServer::start(
            ApiConfig::new(root(), vec![], TOKEN.into())
                .unwrap()
                .with_frontend(
                    dir.path().to_path_buf(),
                    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into(),
                )
                .unwrap(),
        ))
        .unwrap();
    let addr = server.address();
    assert_eq!(http(addr, "GET", "/", "", "").0, 200);
    assert_eq!(http(addr, "GET", "/v1/status", "", "").0, 401);
    let nonce = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let body = format!("{{\"nonce\":\"{nonce}\"}}");
    let evil = "Origin: https://evil.example\r\nContent-Type: application/json\r\n";
    assert_eq!(http(addr, "POST", "/session", evil, &body).0, 403);
    let headers = format!("Origin: http://{addr}\r\nContent-Type: application/json\r\n");
    assert_eq!(http(addr, "POST", "/session", &headers, &body).0, 200);
    assert_eq!(http(addr, "POST", "/session", &headers, &body).0, 401);
    assert_eq!(http(addr, "GET", "/../../etc/passwd", "", "").0, 404);
    rt.block_on(server.shutdown()).unwrap();
}

#[test]
fn origins_tokens_and_host_are_enforced() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let server = rt
        .block_on(ApiServer::start(
            ApiConfig::new(root(), vec!["http://localhost:5173".into()], TOKEN.into()).unwrap(),
        ))
        .unwrap();
    let addr = server.address();
    assert!(addr.ip().is_loopback());
    assert_eq!(http(addr, "GET", "/v1/status", "", "").0, 401);
    assert_eq!(
        http(
            addr,
            "GET",
            "/v1/status",
            "Authorization: Bearer wrong\r\n",
            ""
        )
        .0,
        401
    );
    assert_eq!(
        http(
            addr,
            "GET",
            "/v1/status",
            &format!("{}Origin: https://evil.example\r\n", auth()),
            ""
        )
        .0,
        403
    );
    let (status, response) = http(
        addr,
        "GET",
        "/v1/status",
        &format!("{}Origin: http://localhost:5173\r\n", auth()),
        "",
    );
    assert_eq!(status, 200);
    assert!(response
        .to_ascii_lowercase()
        .contains("access-control-allow-origin: http://localhost:5173"));
    assert_eq!(
        http(
            addr,
            "OPTIONS",
            "/v1/status",
            "Origin: http://localhost:5173\r\nAccess-Control-Request-Method: GET\r\n",
            ""
        )
        .0,
        204
    );
    assert_eq!(
        http(
            addr,
            "OPTIONS",
            "/v1/status",
            "Origin: https://evil.example\r\n",
            ""
        )
        .0,
        403
    );
    assert_eq!(
        http(
            addr,
            "GET",
            "/v1/status",
            &format!("{}Host: evil.example\r\n", auth()),
            ""
        )
        .0,
        403
    );
    let bad = r#"{"mode":"firmware","flash_mb":16,"psram_mb":8,"images":{"app":"/etc/passwd"}}"#;
    assert_eq!(
        http(
            addr,
            "POST",
            "/v1/runtime/start",
            &format!("{}Content-Type: application/json\r\n", auth()),
            bad
        )
        .0,
        422
    );
    rt.block_on(server.shutdown()).unwrap();
    assert!(TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_err());
}

#[test]
fn websocket_requires_auth_and_checks_origin() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let server = rt
        .block_on(ApiServer::start(
            ApiConfig::new(root(), vec!["http://localhost:5173".into()], TOKEN.into()).unwrap(),
        ))
        .unwrap();
    let addr = server.address();
    let url = format!("ws://{addr}/v1/stream");
    let mut bad_origin = url.as_str().into_client_request().unwrap();
    bad_origin
        .headers_mut()
        .insert("Origin", "https://evil.example".parse().unwrap());
    assert!(tungstenite::connect(bad_origin).is_err());
    let (mut socket, _) = tungstenite::connect(url.as_str()).unwrap();
    socket
        .send(Message::Text(
            r#"{"type":"subscribe","status":true}"#.into(),
        ))
        .unwrap();
    assert!(matches!(socket.read(), Ok(Message::Close(_)) | Err(_)));
    let (mut bad_token, _) = tungstenite::connect(url.as_str()).unwrap();
    bad_token
        .send(Message::Text(r#"{"type":"auth","token":"wrong"}"#.into()))
        .unwrap();
    assert!(matches!(bad_token.read(), Ok(Message::Close(_)) | Err(_)));
    let (mut socket, _) = tungstenite::connect(url.as_str()).unwrap();
    socket
        .send(Message::Text(
            format!("{{\"type\":\"auth\",\"token\":\"{TOKEN}\"}}").into(),
        ))
        .unwrap();
    assert!(socket
        .read()
        .unwrap()
        .to_text()
        .unwrap()
        .contains("authenticated"));
    socket
        .send(Message::Text(
            r#"{"type":"subscribe","frames":true,"frame_rate":31}"#.into(),
        ))
        .unwrap();
    assert!(socket
        .read()
        .unwrap()
        .to_text()
        .unwrap()
        .contains("frame_rate"));
    socket
        .send(Message::Text(
            r#"{"type":"subscribe","status":true,"logs":true,"frames":false}"#.into(),
        ))
        .unwrap();
    let first = socket.read().unwrap().to_text().unwrap().to_string();
    assert!(first.contains("status") || first.contains("logs"));
    socket.close(None).unwrap();
    rt.block_on(server.shutdown()).unwrap();
}

#[test]
fn upload_is_bounded_and_accepts_no_paths() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let rt = tokio::runtime::Runtime::new().unwrap();
    let server = rt
        .block_on(ApiServer::start(
            ApiConfig::new(root(), vec![], TOKEN.into()).unwrap(),
        ))
        .unwrap();
    let addr = server.address();
    let headers = format!("{}Content-Type: application/json\r\n", auth());
    let b = STANDARD.encode([0xe9, 0, 0, 0]);
    let p = STANDARD.encode([0u8; 32]);
    let payload =
        serde_json::json!({"bootloader_base64":b,"partition_table_base64":p,"app_base64":b});
    let (code, response) = http(addr, "POST", "/v1/firmware", &headers, &payload.to_string());
    assert_eq!(code, 201);
    assert!(response.contains("image_id"));
    let invalid = serde_json::json!({"bootloader_base64":b,"partition_table_base64":p,"app_base64":b,"path":"/tmp/escape"});
    assert_eq!(
        http(addr, "POST", "/v1/firmware", &headers, &invalid.to_string()).0,
        422
    );
    let too_large = serde_json::json!({"bootloader_base64":"A".repeat(11_184_832),"partition_table_base64":p,"app_base64":b});
    assert_eq!(
        http(
            addr,
            "POST",
            "/v1/firmware",
            &headers,
            &too_large.to_string()
        )
        .0,
        400
    );
    rt.block_on(server.shutdown()).unwrap();
}

#[test]
fn firmware_lifecycle_frame_and_touch_through_api() {
    if std::env::var("STUDIO_RUNTIME_E2E").as_deref() != Ok("1") {
        return;
    }
    let rt = tokio::runtime::Runtime::new().unwrap();
    let server = rt
        .block_on(ApiServer::start(
            ApiConfig::new(root(), vec![], TOKEN.into()).unwrap(),
        ))
        .unwrap();
    let addr = server.address();
    let headers = format!("{}Content-Type: application/json\r\n", auth());
    use base64::{engine::general_purpose::STANDARD, Engine};
    let build = root().join("firmware/esp-idf/build");
    let upload = serde_json::json!({
        "bootloader_base64": STANDARD.encode(std::fs::read(build.join("bootloader/bootloader.bin")).unwrap()),
        "partition_table_base64": STANDARD.encode(std::fs::read(build.join("partition_table/partition-table.bin")).unwrap()),
        "app_base64": STANDARD.encode(std::fs::read(build.join("amoled_studio_175c.bin")).unwrap())
    });
    let (code, response) = http(addr, "POST", "/v1/firmware", &headers, &upload.to_string());
    assert_eq!(code, 201, "{response}");
    let response_body: serde_json::Value =
        serde_json::from_str(response.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    let body = serde_json::json!({"mode":"firmware","flash_mb":16,"psram_mb":8,"image_id":response_body["image_id"]}).to_string();
    let (code, response) = http(addr, "POST", "/v1/runtime/start", &headers, &body);
    assert_eq!(code, 200, "{response}");
    let body = response.split("\r\n\r\n").nth(1).unwrap();
    let status: serde_json::Value = serde_json::from_str(body).unwrap();
    assert!(status["status"]["viewer_url"].is_null());
    let pid = status["status"]["pid"].as_u64().unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    loop {
        let (_, logs) = http(addr, "GET", "/v1/logs", &auth(), "");
        if logs.contains("AMOLED_FIRMWARE_LVGL_READY") {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "firmware did not start: {logs}"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    std::thread::sleep(Duration::from_millis(150));
    let (code, before) = http(addr, "GET", "/v1/frame", &auth(), "");
    assert_eq!(code, 200);
    assert!(before.contains("png_base64"));
    let (mut ws, _) = tungstenite::connect(format!("ws://{addr}/v1/stream")).unwrap();
    ws.send(Message::Text(
        format!("{{\"type\":\"auth\",\"token\":\"{TOKEN}\"}}").into(),
    ))
    .unwrap();
    assert!(ws
        .read()
        .unwrap()
        .to_text()
        .unwrap()
        .contains("authenticated"));
    ws.send(Message::Text(
        r#"{"type":"subscribe","status":false,"logs":false,"frames":true}"#.into(),
    ))
    .unwrap();
    let event = ws.read().unwrap().to_text().unwrap().to_string();
    assert!(event.contains("\"type\":\"frame\""));
    let down = r#"{"action":"press","x":234,"y":264}"#;
    assert_eq!(http(addr, "POST", "/v1/touch", &headers, down).0, 200);
    std::thread::sleep(Duration::from_millis(200));
    let frame_start = std::time::Instant::now();
    ws.send(Message::Text(
        r#"{"type":"touch","request":{"action":"release","x":234,"y":264}}"#.into(),
    ))
    .unwrap();
    loop {
        let message = ws.read().unwrap();
        if let Ok(text) = message.to_text() {
            if text.contains("touch_result") {
                assert!(text.contains("\"ok\":true"));
                break;
            }
        }
    }
    loop {
        let msg = ws.read().unwrap();
        if msg
            .to_text()
            .is_ok_and(|v| v.contains("\"type\":\"frame\""))
        {
            eprintln!(
                "first streamed frame after release: {:?}",
                frame_start.elapsed()
            );
            break;
        }
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let (_, logs) = http(addr, "GET", "/v1/logs", &auth(), "");
        if logs.contains("AMOLED_FIRMWARE_SCREEN_1") {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "touch did not arrive: {logs}"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    std::thread::sleep(Duration::from_millis(200));
    let (code, after) = http(addr, "GET", "/v1/frame", &auth(), "");
    assert_eq!(code, 200);
    assert_ne!(before, after);
    // Deliver a burst through actual authenticated HTTP. The emulator must
    // preserve transitions even when the host does not wait between calls.
    let (_, logs_before) = http(addr, "GET", "/v1/logs", &auth(), "");
    let baseline = logs_before.matches("AMOLED_FIRMWARE_SCREEN_").count();
    let started = std::time::Instant::now();
    for _ in 0..8 {
        assert_eq!(http(addr, "POST", "/v1/touch", &headers, down).0, 200);
        assert_eq!(
            http(
                addr,
                "POST",
                "/v1/touch",
                &headers,
                r#"{"action":"release","x":234,"y":264}"#
            )
            .0,
            200
        );
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        let (_, logs) = http(addr, "GET", "/v1/logs", &auth(), "");
        let received = logs.matches("AMOLED_FIRMWARE_SCREEN_").count() - baseline;
        if received >= 8 {
            eprintln!(
                "burst: {received}/8 firmware taps in {:?}",
                started.elapsed()
            );
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "burst received {received}/8 taps"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    let baseline = {
        let (_, logs) = http(addr, "GET", "/v1/logs", &auth(), "");
        logs.matches("AMOLED_FIRMWARE_SCREEN_").count()
    };
    let started = std::time::Instant::now();
    for _ in 0..8 {
        assert_eq!(http(addr, "POST", "/v1/touch", &headers, down).0, 200);
        std::thread::sleep(Duration::from_millis(80));
        assert_eq!(
            http(
                addr,
                "POST",
                "/v1/touch",
                &headers,
                r#"{"action":"release","x":234,"y":264}"#
            )
            .0,
            200
        );
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        let (_, logs) = http(addr, "GET", "/v1/logs", &auth(), "");
        let received = logs.matches("AMOLED_FIRMWARE_SCREEN_").count() - baseline;
        if received >= 8 {
            eprintln!("80ms taps: {received}/8 in {:?}", started.elapsed());
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "80ms holds received {received}/8 taps"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    // A long hold away from the button must still release cleanly.
    assert_eq!(
        http(
            addr,
            "POST",
            "/v1/touch",
            &headers,
            r#"{"action":"press","x":234,"y":180}"#
        )
        .0,
        200
    );
    std::thread::sleep(Duration::from_millis(650));
    assert_eq!(
        http(
            addr,
            "POST",
            "/v1/touch",
            &headers,
            r#"{"action":"release","x":234,"y":180}"#
        )
        .0,
        200
    );
    // Disconnect during a press: the server must synthesize release.
    ws.send(Message::Text(
        r#"{"type":"touch","request":{"action":"press","x":234,"y":264}}"#.into(),
    ))
    .unwrap();
    loop {
        let message = ws.read().unwrap();
        if let Ok(text) = message.to_text() {
            if text.contains("touch_result") {
                assert!(text.contains("\"ok\":true"));
                break;
            }
        }
    }
    std::thread::sleep(Duration::from_millis(200));
    ws.close(None).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let (_, logs) = http(addr, "GET", "/v1/logs", &auth(), "");
        if logs.contains("AMOLED_FIRMWARE_SCREEN_0") {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "disconnect did not release touch: {logs}"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    // Server shutdown owns stopping/reaping the child, even without an explicit stop request.
    rt.block_on(server.shutdown()).unwrap();
    #[cfg(unix)]
    assert!(!std::process::Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .output()
        .unwrap()
        .status
        .success());
}

#[cfg(unix)]
#[test]
fn cli_creates_private_token_file_and_removes_it_on_sigterm() {
    use std::{
        io::BufRead,
        os::unix::fs::PermissionsExt,
        process::{Command, Stdio},
    };
    let mut child = Command::new(env!("CARGO_BIN_EXE_amoled-api"))
        .args(["--project", root().to_str().unwrap()])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    std::io::BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let value: serde_json::Value = serde_json::from_str(&line).unwrap();
    let token_path = std::path::PathBuf::from(value["token_file"].as_str().unwrap());
    let metadata = std::fs::metadata(&token_path).unwrap();
    assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
    assert_eq!(std::fs::read_to_string(&token_path).unwrap().len(), 64);
    assert!(Command::new("/bin/kill")
        .args(["-TERM", &child.id().to_string()])
        .status()
        .unwrap()
        .success());
    assert!(child.wait().unwrap().success());
    assert!(!token_path.exists());
}

#[cfg(unix)]
#[test]
fn api_exposes_crash_and_allows_restart() {
    use std::{fs, os::unix::fs::PermissionsExt};
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("build")).unwrap();
    let executable = root.path().join("build/amoled-simulator");
    fs::write(
        &executable,
        "#!/bin/sh\necho intentional-crash >&2\nexit 9\n",
    )
    .unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
    let rt = tokio::runtime::Runtime::new().unwrap();
    let server = rt
        .block_on(ApiServer::start(
            ApiConfig::new(root.path().to_path_buf(), vec![], TOKEN.into()).unwrap(),
        ))
        .unwrap();
    let addr = server.address();
    let headers = format!("{}Content-Type: application/json\r\n", auth());
    let config = r#"{"mode":"simulator","battery_percent":70,"brightness_percent":60,"accel_x":0.0,"time_ms":0}"#;
    assert_eq!(
        http(addr, "POST", "/v1/runtime/start", &headers, config).0,
        200
    );
    let (code, current_config) = http(addr, "GET", "/v1/config", &auth(), "");
    assert_eq!(code, 200);
    assert!(current_config.contains("\"battery_percent\":70"));
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let (_, status) = http(addr, "GET", "/v1/status", &auth(), "");
        if status.contains("\"failed\"") {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "no failure reported: {status}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(http(addr, "POST", "/v1/runtime/stop", &auth(), "").0, 200);
    assert_eq!(
        http(addr, "POST", "/v1/runtime/start", &headers, config).0,
        200
    );
    rt.block_on(server.shutdown()).unwrap();
}

#[test]
fn shutdown_does_not_wait_for_incomplete_http_body() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let server = rt
        .block_on(ApiServer::start(
            ApiConfig::new(root(), vec![], TOKEN.into()).unwrap(),
        ))
        .unwrap();
    let addr = server.address();
    let mut socket = TcpStream::connect(addr).unwrap();
    write!(socket, "POST /v1/firmware HTTP/1.1\r\nHost: {addr}\r\n{}Content-Type: application/json\r\nContent-Length: 1000\r\n\r\n{{", auth()).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    let result = rt
        .block_on(async { tokio::time::timeout(Duration::from_secs(3), server.shutdown()).await });
    assert!(
        result.is_ok(),
        "shutdown hung on an incomplete request body"
    );
    result.unwrap().unwrap();
}

#[test]
fn shutdown_closes_authenticated_websocket() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let server = rt
        .block_on(ApiServer::start(
            ApiConfig::new(root(), vec![], TOKEN.into()).unwrap(),
        ))
        .unwrap();
    let addr = server.address();
    let (mut ws, _) = tungstenite::connect(format!("ws://{addr}/v1/stream")).unwrap();
    if let tungstenite::stream::MaybeTlsStream::Plain(stream) = ws.get_mut() {
        stream
            .set_read_timeout(Some(Duration::from_secs(4)))
            .unwrap();
    }
    ws.send(Message::Text(
        format!("{{\"type\":\"auth\",\"token\":\"{TOKEN}\"}}").into(),
    ))
    .unwrap();
    assert!(ws
        .read()
        .unwrap()
        .to_text()
        .unwrap()
        .contains("authenticated"));
    rt.block_on(server.shutdown()).unwrap();
    assert!(matches!(ws.read(), Ok(Message::Close(_)) | Err(_)));
}
