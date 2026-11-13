//! Process supervisor and versioned backend contract for AMOLED Studio.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tungstenite::client::IntoClientRequest;
use tungstenite::{client, Message};

pub mod http_api;
pub const API_VERSION: u32 = 1;
const MAX_LOGS: usize = 500;
const MAX_LINE: usize = 4096;
const BOARD: &str = "waveshare-esp32-s3-touch-amoled-1.75c";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeKind {
    Simulator,
    Firmware,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Stopped,
    Running,
    Failed,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardProfile {
    pub api_version: u32,
    pub id: String,
    pub width: u16,
    pub height: u16,
    pub shape: String,
    pub flash_options_mb: Vec<u16>,
    pub psram_mb: u16,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FirmwareImages {
    pub bootloader: PathBuf,
    pub partition_table: PathBuf,
    pub app: PathBuf,
    pub elf: Option<PathBuf>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum RuntimeConfig {
    Simulator {
        battery_percent: u8,
        brightness_percent: u8,
        accel_x: f32,
        time_ms: u64,
    },
    Firmware {
        flash_mb: u16,
        psram_mb: u16,
        images: FirmwareImages,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeStatus {
    pub api_version: u32,
    pub board: String,
    pub state: State,
    pub kind: Option<RuntimeKind>,
    pub pid: Option<u32>,
    pub viewer_url: Option<String>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub stream: String,
    pub message: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameSnapshot {
    pub width: u16,
    pub height: u16,
    pub format: String,
    pub data_base64: String,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TouchAction {
    Press,
    Move,
    Release,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TouchRequest {
    pub action: TouchAction,
    pub x: u16,
    pub y: u16,
}

struct Managed {
    child: Option<Child>,
    state: State,
    kind: Option<RuntimeKind>,
    port: Option<u16>,
    exit_code: Option<i32>,
    error: Option<String>,
    touch_down: bool,
}
pub struct RuntimeManager {
    root: PathBuf,
    transport_secret: Option<String>,
    inner: Mutex<Managed>,
    logs: Arc<Mutex<VecDeque<LogEntry>>>,
}
impl RuntimeManager {
    pub fn new(root: PathBuf) -> Self {
        let root = fs::canonicalize(&root).unwrap_or(root);
        Self {
            root,
            transport_secret: None,
            inner: Mutex::new(Managed {
                child: None,
                state: State::Stopped,
                kind: None,
                port: None,
                exit_code: None,
                error: None,
                touch_down: false,
            }),
            logs: Arc::new(Mutex::new(VecDeque::new())),
        }
    }
    pub(crate) fn with_private_transport(root: PathBuf, secret: String) -> Self {
        let mut manager = Self::new(root);
        manager.transport_secret = Some(secret);
        manager
    }
    /// A desktop host can keep the emulator viewer private while relaying frames in-process.
    pub fn new_private(root: PathBuf) -> Result<Self, String> {
        Ok(Self::with_private_transport(
            root,
            http_api::generate_token()?,
        ))
    }
    pub fn board_profile(&self) -> BoardProfile {
        BoardProfile {
            api_version: API_VERSION,
            id: BOARD.into(),
            width: 466,
            height: 466,
            shape: "round".into(),
            flash_options_mb: vec![16, 32],
            psram_mb: 8,
        }
    }
    pub fn default_firmware_images(&self) -> FirmwareImages {
        let build = self.root.join("firmware/esp-idf/build");
        FirmwareImages {
            bootloader: build.join("bootloader/bootloader.bin"),
            partition_table: build.join("partition_table/partition-table.bin"),
            app: build.join("amoled_studio_175c.bin"),
            elf: Some(build.join("amoled_studio_175c.elf")),
        }
    }
    pub fn validate_installation(&self) -> Result<(), String> {
        require_file(&self.root.join("build/amoled-simulator"))?;
        require_file(&self.root.join(".tools/esp32sim/target/release/esp32sim"))?;
        let images = self.default_firmware_images();
        for path in [&images.bootloader, &images.partition_table, &images.app] {
            require_file(path)?;
        }
        if let Some(elf) = images.elf {
            require_file(&elf)?;
        }
        Ok(())
    }
    fn refresh(m: &mut Managed) {
        if let Some(child) = m.child.as_mut() {
            match child.try_wait() {
                Ok(Some(exit)) => {
                    m.exit_code = exit.code();
                    m.state = if exit.success() {
                        State::Stopped
                    } else {
                        State::Failed
                    };
                    if !exit.success() {
                        m.error = Some(format!("process exited: {exit}"));
                    }
                    m.child = None;
                    m.port = None;
                    m.touch_down = false;
                }
                Ok(None) => (),
                Err(e) => {
                    m.state = State::Failed;
                    m.error = Some(format!("failed to inspect process: {e}"));
                }
            }
        }
    }
    pub fn status(&self) -> RuntimeStatus {
        let mut m = self.inner.lock().unwrap();
        Self::refresh(&mut m);
        RuntimeStatus {
            api_version: API_VERSION,
            board: BOARD.into(),
            state: m.state,
            kind: m.kind,
            pid: m.child.as_ref().map(Child::id),
            viewer_url: if self.transport_secret.is_some() {
                None
            } else {
                m.port.map(|p| format!("http://127.0.0.1:{p}/run.html"))
            },
            exit_code: m.exit_code,
            error: m.error.clone(),
        }
    }
    pub fn logs(&self) -> Vec<LogEntry> {
        self.logs.lock().unwrap().iter().cloned().collect()
    }
    pub fn start(&self, config: RuntimeConfig) -> Result<RuntimeStatus, String> {
        let mut m = self.inner.lock().map_err(|e| e.to_string())?;
        Self::refresh(&mut m);
        if m.child.is_some() {
            return Err("a runtime is already active".into());
        }
        let (mut cmd, kind, port) = self.command(config)?;
        self.logs.lock().unwrap().clear();
        cmd.env_remove("AMOLED_ESP32SIM_TOKEN");
        if let Some(secret) = &self.transport_secret {
            if kind == RuntimeKind::Firmware {
                cmd.env("AMOLED_ESP32SIM_TOKEN", secret);
                cmd.args(["--net", "none"]);
            }
        }
        cmd.current_dir(&self.root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not start {kind:?}: {e}"))?;
        if let Some(out) = child.stdout.take() {
            Self::collect(out, "stdout", self.logs.clone());
        }
        if let Some(out) = child.stderr.take() {
            Self::collect(out, "stderr", self.logs.clone());
        }
        m.kind = Some(kind);
        m.state = State::Running;
        m.exit_code = None;
        m.error = None;
        m.port = port;
        m.touch_down = false;
        m.child = Some(child);
        if let Some(port) = port {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                Self::refresh(&mut m);
                if m.child.is_none() {
                    return Err(m
                        .error
                        .clone()
                        .unwrap_or_else(|| "emulator exited during startup".into()));
                }
                if TcpStream::connect_timeout(
                    &([127, 0, 0, 1], port).into(),
                    Duration::from_millis(100),
                )
                .is_ok()
                {
                    if let Some(secret) = &self.transport_secret {
                        // Refuse to use an older or unpatched, publicly controllable listener.
                        if !transport_requires_auth(port) {
                            if let Some(mut child) = m.child.take() {
                                let _ = child.kill();
                                let _ = child.wait();
                            }
                            m.state = State::Failed;
                            m.port = None;
                            m.error = Some(
                                "unprotected emulator transport; rerun setup-esp32sim.sh".into(),
                            );
                            return Err(m.error.clone().unwrap());
                        }
                        if websocket(port, Some(secret)).is_err() {
                            thread::sleep(Duration::from_millis(30));
                            continue;
                        }
                    }
                    break;
                }
                if Instant::now() >= deadline {
                    if let Some(mut child) = m.child.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                    m.state = State::Failed;
                    m.port = None;
                    m.error = Some("emulator viewer startup timed out".into());
                    return Err(m.error.clone().unwrap());
                }
                thread::sleep(Duration::from_millis(30));
            }
        }
        drop(m);
        Ok(self.status())
    }
    fn command(
        &self,
        config: RuntimeConfig,
    ) -> Result<(Command, RuntimeKind, Option<u16>), String> {
        match config {
            RuntimeConfig::Simulator {
                battery_percent,
                brightness_percent,
                accel_x,
                time_ms,
            } => {
                if battery_percent > 100 || brightness_percent > 100 || !accel_x.is_finite() {
                    return Err("invalid simulator mock values".into());
                }
                let exe = self.root.join("build/amoled-simulator");
                require_file(&exe)?;
                let mut c = Command::new(exe);
                c.env("STUDIO_BATTERY", battery_percent.to_string())
                    .env("STUDIO_BRIGHTNESS", brightness_percent.to_string())
                    .env("STUDIO_ACCEL_X", accel_x.to_string())
                    .env("STUDIO_TIME_MS", time_ms.to_string());
                Ok((c, RuntimeKind::Simulator, None))
            }
            RuntimeConfig::Firmware {
                flash_mb,
                psram_mb,
                images,
            } => {
                if ![16, 32].contains(&flash_mb) || psram_mb != 8 {
                    return Err("firmware requires virtual flash 16 or 32 MB and 8 MB PSRAM".into());
                }
                validate_images(&images)?;
                let exe = self.root.join(".tools/esp32sim/target/release/esp32sim");
                require_file(&exe)?;
                let listener = TcpListener::bind(("127.0.0.1", 0))
                    .map_err(|e| format!("cannot reserve viewer port: {e}"))?;
                let port = listener.local_addr().map_err(|e| e.to_string())?.port();
                drop(listener);
                let mut c = Command::new(exe);
                let packaged_rom = self.root.join("rom/esp32s3_rev0_rom.elf");
                if packaged_rom.is_file() {
                    c.arg("--rom").arg(packaged_rom);
                }
                c.args([
                    "--chip",
                    "s3",
                    "--board",
                    "waveshare-amoled175c",
                    "--boot",
                    "rom",
                    "--console",
                    "uart0",
                    "--flash-mb",
                    &flash_mb.to_string(),
                    "--psram-mb",
                    &psram_mb.to_string(),
                    "--bootloader",
                ])
                .arg(&images.bootloader)
                .arg("--ptable")
                .arg(&images.partition_table)
                .arg("--app")
                .arg(&images.app);
                if let Some(elf) = images.elf {
                    c.arg("--elf").arg(elf);
                }
                c.args(["--web", &port.to_string(), "--no-dump"]);
                Ok((c, RuntimeKind::Firmware, Some(port)))
            }
        }
    }
    fn collect<R: Read + Send + 'static>(
        source: R,
        stream: &'static str,
        logs: Arc<Mutex<VecDeque<LogEntry>>>,
    ) {
        thread::spawn(move || {
            let mut reader = BufReader::new(source);
            loop {
                let mut bytes = Vec::new();
                match reader
                    .by_ref()
                    .take((MAX_LINE + 1) as u64)
                    .read_until(b'\n', &mut bytes)
                {
                    Ok(0) => break,
                    Ok(_) => {
                        let message = String::from_utf8_lossy(&bytes).trim_end().to_string();
                        let mut q = logs.lock().unwrap();
                        if q.len() == MAX_LOGS {
                            q.pop_front();
                        }
                        q.push_back(LogEntry {
                            stream: stream.into(),
                            message,
                        });
                    }
                    Err(e) => {
                        let mut q = logs.lock().unwrap();
                        if q.len() == MAX_LOGS {
                            q.pop_front();
                        }
                        q.push_back(LogEntry {
                            stream: stream.into(),
                            message: format!("log read error: {e}"),
                        });
                        break;
                    }
                }
            }
        });
    }
    pub fn stop(&self) -> Result<RuntimeStatus, String> {
        let mut m = self.inner.lock().map_err(|e| e.to_string())?;
        Self::refresh(&mut m);
        if let Some(mut child) = m.child.take() {
            if let Err(e) = child.kill() {
                if child.try_wait().ok().flatten().is_none() {
                    m.child = Some(child);
                    return Err(format!("cannot stop runtime: {e}"));
                }
            }
            child
                .wait()
                .map_err(|e| format!("cannot reap runtime: {e}"))?;
        }
        m.state = State::Stopped;
        m.port = None;
        m.touch_down = false;
        m.error = None;
        m.exit_code = None;
        drop(m);
        Ok(self.status())
    }
    fn active_port(&self) -> Result<u16, String> {
        let mut m = self.inner.lock().map_err(|e| e.to_string())?;
        Self::refresh(&mut m);
        m.port
            .ok_or_else(|| "firmware emulator is not running".into())
    }
    /// Connect to the supervised firmware's frame stream without exposing its credentials to a UI.
    pub fn connect_frame_stream(&self) -> Result<tungstenite::WebSocket<TcpStream>, String> {
        websocket(self.active_port()?, self.transport_secret.as_deref())
    }
    pub fn snapshot(&self) -> Result<FrameSnapshot, String> {
        frame_to_png(&self.snapshot_raw()?)
    }
    pub(crate) fn snapshot_raw(&self) -> Result<Vec<u8>, String> {
        let port = self.active_port()?;
        let mut ws = websocket(port, self.transport_secret.as_deref())?;
        loop {
            match ws.read().map_err(|e| format!("frame read failed: {e}"))? {
                Message::Binary(frame) if frame.first() == Some(&1) => return Ok(frame.to_vec()),
                Message::Close(_) => return Err("emulator closed the frame stream".into()),
                _ => (),
            }
        }
    }
    pub fn touch(&self, req: TouchRequest) -> Result<(), String> {
        let mut m = self.inner.lock().map_err(|e| e.to_string())?;
        Self::refresh(&mut m);
        let port = m.port.ok_or("firmware emulator is not running")?;
        if req.x >= 466 || req.y >= 466 {
            return Err("touch is outside display bounds".into());
        }
        let dx = 2 * i32::from(req.x) + 1 - 466;
        let dy = 2 * i32::from(req.y) + 1 - 466;
        if matches!(req.action, TouchAction::Press) && dx * dx + dy * dy > 466 * 466 {
            return Err("touch press is outside the round display".into());
        }
        let down = match req.action {
            TouchAction::Press if !m.touch_down => true,
            TouchAction::Move if m.touch_down => true,
            TouchAction::Release if m.touch_down => false,
            _ => return Err("invalid touch sequence".into()),
        };
        let mut ws = websocket(port, self.transport_secret.as_deref())?;
        let msg =
            serde_json::json!({"t":"touch", "x":req.x, "y":req.y, "down":if down {1} else {0}})
                .to_string();
        ws.send(Message::Text(msg.into()))
            .map_err(|e| format!("touch send failed: {e}"))?;
        // The emulator enqueues text before responding to a ping on the same
        // connection. Wait for that barrier before allowing the next HTTP call.
        ws.send(Message::Ping(vec![0x54].into()))
            .map_err(|e| format!("touch barrier failed: {e}"))?;
        loop {
            match ws
                .read()
                .map_err(|e| format!("touch acknowledgement failed: {e}"))?
            {
                Message::Pong(data) if data.as_ref() == [0x54] => break,
                Message::Close(_) => return Err("emulator closed touch transport".into()),
                _ => (),
            }
        }
        m.touch_down = down;
        Ok(())
    }
}
impl Drop for RuntimeManager {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
fn require_file(path: &Path) -> Result<(), String> {
    if path.is_file() {
        Ok(())
    } else {
        Err(format!("file not found: {}", path.display()))
    }
}
fn validate_images(images: &FirmwareImages) -> Result<(), String> {
    for p in [&images.bootloader, &images.partition_table, &images.app] {
        if !p.is_absolute() {
            return Err(format!(
                "firmware image path must be absolute: {}",
                p.display()
            ));
        }
        require_file(p)?;
    }
    for p in [&images.bootloader, &images.app] {
        let mut f = fs::File::open(p).map_err(|e| e.to_string())?;
        let mut b = [0u8; 1];
        f.read_exact(&mut b).map_err(|e| e.to_string())?;
        if b[0] != 0xe9 {
            return Err(format!("not an ESP image: {}", p.display()));
        }
    }
    if fs::metadata(&images.partition_table)
        .map_err(|e| e.to_string())?
        .len()
        < 32
    {
        return Err("partition table is too short".into());
    }
    if let Some(p) = &images.elf {
        if !p.is_absolute() {
            return Err("ELF path must be absolute".into());
        }
        require_file(p)?;
    }
    Ok(())
}
fn transport_requires_auth(port: u16) -> bool {
    let Ok(mut stream) =
        TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(1))
    else {
        return false;
    };
    if stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .is_err()
    {
        return false;
    }
    if write!(
        stream,
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return false;
    }
    let mut line = String::new();
    match BufReader::new(stream).take(128).read_line(&mut line) {
        Ok(_) => line.starts_with("HTTP/1.1 401 "),
        Err(_) => false,
    }
}
fn websocket(port: u16, secret: Option<&str>) -> Result<tungstenite::WebSocket<TcpStream>, String> {
    let stream = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(2))
        .map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(4)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    let mut request = format!("ws://127.0.0.1:{port}/")
        .into_client_request()
        .map_err(|e| e.to_string())?;
    if let Some(secret) = secret {
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {secret}")
                .parse()
                .map_err(|_| "invalid internal token")?,
        );
    }
    let (ws, _) = client(request, stream).map_err(|e| format!("viewer connection failed: {e}"))?;
    Ok(ws)
}
fn frame_to_png(data: &[u8]) -> Result<FrameSnapshot, String> {
    if data.len() < 5 {
        return Err("short frame".into());
    }
    let w = u16::from_le_bytes([data[1], data[2]]);
    let h = u16::from_le_bytes([data[3], data[4]]);
    if (w, h) != (466, 466) || data.len() != 5 + usize::from(w) * usize::from(h) * 2 {
        return Err("invalid frame dimensions or length".into());
    }
    let mut rgb = Vec::with_capacity(usize::from(w) * usize::from(h) * 3);
    for px in data[5..].chunks_exact(2) {
        let p = u16::from_le_bytes([px[0], px[1]]);
        rgb.extend_from_slice(&[
            (((p >> 11) & 31) * 255 / 31) as u8,
            (((p >> 5) & 63) * 255 / 63) as u8,
            ((p & 31) * 255 / 31) as u8,
        ]);
    }
    let mut result = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut result, u32::from(w), u32::from(h));
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&rgb).map_err(|e| e.to_string())?;
    }
    Ok(FrameSnapshot {
        width: w,
        height: h,
        format: "png_base64".into(),
        data_base64: STANDARD.encode(result),
    })
}

#[cfg(feature = "tauri-commands")]
pub mod tauri_commands {
    use super::*;
    // Blocking process and socket work runs away from the desktop UI thread.
    #[tauri::command]
    pub fn get_board_profile(manager: tauri::State<'_, Arc<RuntimeManager>>) -> BoardProfile {
        manager.board_profile()
    }
    #[tauri::command]
    pub fn get_default_firmware_images(
        manager: tauri::State<'_, Arc<RuntimeManager>>,
    ) -> Result<FirmwareImages, String> {
        manager
            .validate_installation()
            .map_err(|e| format!("Runtime initialization failed: {e}"))?;
        Ok(manager.default_firmware_images())
    }
    #[tauri::command]
    pub async fn start_runtime(
        manager: tauri::State<'_, Arc<RuntimeManager>>,
        config: RuntimeConfig,
    ) -> Result<RuntimeStatus, String> {
        let manager = Arc::clone(manager.inner());
        tauri::async_runtime::spawn_blocking(move || manager.start(config))
            .await
            .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    pub async fn stop_runtime(
        manager: tauri::State<'_, Arc<RuntimeManager>>,
    ) -> Result<RuntimeStatus, String> {
        let manager = Arc::clone(manager.inner());
        tauri::async_runtime::spawn_blocking(move || manager.stop())
            .await
            .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    pub async fn get_runtime_status(
        manager: tauri::State<'_, Arc<RuntimeManager>>,
    ) -> Result<RuntimeStatus, String> {
        let manager = Arc::clone(manager.inner());
        tauri::async_runtime::spawn_blocking(move || manager.status())
            .await
            .map_err(|e| e.to_string())
    }
    #[tauri::command]
    pub fn get_runtime_logs(manager: tauri::State<'_, Arc<RuntimeManager>>) -> Vec<LogEntry> {
        manager.logs()
    }
    #[tauri::command]
    pub async fn capture_framebuffer(
        manager: tauri::State<'_, Arc<RuntimeManager>>,
    ) -> Result<FrameSnapshot, String> {
        let manager = Arc::clone(manager.inner());
        tauri::async_runtime::spawn_blocking(move || manager.snapshot())
            .await
            .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    pub async fn send_touch(
        manager: tauri::State<'_, Arc<RuntimeManager>>,
        request: TouchRequest,
    ) -> Result<(), String> {
        let manager = Arc::clone(manager.inner());
        tauri::async_runtime::spawn_blocking(move || manager.touch(request))
            .await
            .map_err(|e| e.to_string())?
    }
}

#[cfg(test)]
mod private_transport_tests {
    use super::*;
    #[test]
    fn unchanged_frame_benchmark() {
        if std::env::var("STUDIO_FRAME_BENCH").as_deref() != Ok("1") {
            return;
        }
        let mut frame = vec![0u8; 5 + 466 * 466 * 2];
        frame[..5].copy_from_slice(&[1, 210, 1, 210, 1]);
        let previous = frame.clone();
        let start = std::time::Instant::now();
        for _ in 0..10 {
            std::hint::black_box(frame_to_png(std::hint::black_box(&frame)).unwrap());
        }
        let encoding = start.elapsed();
        let start = std::time::Instant::now();
        for _ in 0..10 {
            std::hint::black_box(std::hint::black_box(&frame) == std::hint::black_box(&previous));
        }
        eprintln!(
            "10 unchanged frames: encode {:?}; raw comparison {:?}",
            encoding,
            start.elapsed()
        );
    }
    #[test]
    fn private_listener_requires_authentication() {
        if std::env::var("STUDIO_RUNTIME_E2E").as_deref() != Ok("1") {
            return;
        }
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();
        let manager = RuntimeManager::with_private_transport(root, "b".repeat(64));
        let images = manager.default_firmware_images();
        manager
            .start(RuntimeConfig::Firmware {
                flash_mb: 16,
                psram_mb: 8,
                images,
            })
            .unwrap();
        let port = manager.inner.lock().unwrap().port.unwrap();
        assert!(transport_requires_auth(port));
        assert!(websocket(port, None).is_err());
        assert!(websocket(port, Some(&"c".repeat(64))).is_err());
        assert!(websocket(port, Some(&"b".repeat(64))).is_ok());
        manager.stop().unwrap();
    }
}
