//! Loopback-only HTTP/WebSocket API. No remote path or command execution endpoints.
use crate::{FirmwareImages, RuntimeConfig, RuntimeManager, TouchRequest, API_VERSION};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Request, State,
    },
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use subtle::ConstantTimeEq;
use tempfile::TempDir;
use tokio::{
    sync::{watch, Semaphore},
    task::JoinHandle,
};

const MAX_UPLOAD: usize = 8 * 1024 * 1024;
const MAX_BODY: usize = 36 * 1024 * 1024;
const MAX_IMAGES: usize = 4;
const MAX_WS: usize = 8;

pub struct ApiConfig {
    root: PathBuf,
    origins: Vec<String>,
    token: String,
    port: u16,
    frontend: Option<(PathBuf, String)>,
}
impl ApiConfig {
    pub fn new(root: PathBuf, origins: Vec<String>, token: String) -> Result<Self, String> {
        if token.len() != 64
            || !token
                .bytes()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        {
            return Err(
                "token must be 64 lowercase hexadecimal characters generated from 32 random bytes"
                    .into(),
            );
        }
        for origin in &origins {
            if origin == "tauri://localhost" {
                continue;
            }
            let u = url::Url::parse(origin).map_err(|_| "invalid allowed origin")?;
            if !matches!(u.scheme(), "http" | "https")
                || u.host().is_none()
                || !u.username().is_empty()
                || u.password().is_some()
                || u.path() != "/"
                || u.query().is_some()
                || u.fragment().is_some()
                || u.origin().ascii_serialization() != *origin
            {
                return Err("allowed origins must be exact http(s) origins without a path".into());
            }
        }
        let root = fs::canonicalize(root).map_err(|e| format!("project root: {e}"))?;
        Ok(Self {
            root,
            origins,
            token,
            port: 0,
            frontend: None,
        })
    }
    pub fn with_port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }
    pub fn with_frontend(mut self, path: PathBuf, nonce: String) -> Result<Self, String> {
        if nonce.len() != 64
            || !nonce
                .bytes()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        {
            return Err("invalid bootstrap nonce".into());
        }
        let path = fs::canonicalize(path).map_err(|e| format!("frontend directory: {e}"))?;
        if !path.join("index.html").is_file() {
            return Err("frontend index.html missing".into());
        }
        self.frontend = Some((path, nonce));
        Ok(self)
    }
}

pub fn generate_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("system random source: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn constant_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && bool::from(a.as_bytes().ct_eq(b.as_bytes()))
}
#[derive(Clone)]
struct App {
    manager: Arc<RuntimeManager>,
    token: Arc<String>,
    origins: Arc<Vec<String>>,
    port: u16,
    storage: Arc<TempDir>,
    images: Arc<Mutex<HashMap<String, FirmwareImages>>>,
    last_config: Arc<Mutex<Option<StartRequest>>>,
    operations: Arc<Mutex<()>>,
    closing: Arc<AtomicBool>,
    stop: watch::Receiver<bool>,
    connections: Arc<Semaphore>,
    frontend: Option<PathBuf>,
    nonce: Arc<Mutex<Option<String>>>,
}

pub struct ApiServer {
    addr: SocketAddr,
    stop: watch::Sender<bool>,
    task: Option<JoinHandle<Result<(), String>>>,
    closing: Arc<AtomicBool>,
}
impl ApiServer {
    pub async fn start(config: ApiConfig) -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, config.port))
            .await
            .map_err(|e| e.to_string())?;
        let addr = listener.local_addr().map_err(|e| e.to_string())?;
        let storage = tempfile::Builder::new()
            .prefix("amoled-api-")
            .tempdir()
            .map_err(|e| e.to_string())?;
        let manager = Arc::new(RuntimeManager::with_private_transport(
            config.root,
            generate_token()?,
        ));
        let (tx, rx) = watch::channel(false);
        let operations = Arc::new(Mutex::new(()));
        let closing = Arc::new(AtomicBool::new(false));
        let (frontend, nonce) = match config.frontend {
            Some((p, n)) => (Some(p), Some(n)),
            None => (None, None),
        };
        let mut origins = config.origins;
        if frontend.is_some() {
            origins.push(format!("http://{addr}"));
        }
        let state = App {
            manager: manager.clone(),
            token: Arc::new(config.token),
            origins: Arc::new(origins),
            port: addr.port(),
            storage: Arc::new(storage),
            images: Arc::new(Mutex::new(HashMap::new())),
            last_config: Arc::new(Mutex::new(None)),
            operations: operations.clone(),
            closing: closing.clone(),
            stop: rx.clone(),
            connections: Arc::new(Semaphore::new(MAX_WS)),
            frontend,
            nonce: Arc::new(Mutex::new(nonce)),
        };
        let router = Router::new()
            .route("/session", post(browser_session))
            .route("/v1/board", get(board))
            .route("/v1/status", get(status))
            .route("/v1/config", get(configuration))
            .route("/v1/logs", get(logs))
            .route("/v1/runtime/start", post(start))
            .route("/v1/runtime/stop", post(stop_runtime))
            .route("/v1/firmware", post(upload))
            .route("/v1/frame", get(frame))
            .route("/v1/touch", post(touch))
            .route("/v1/stream", get(stream))
            .fallback(static_frontend)
            .layer(DefaultBodyLimit::max(MAX_BODY))
            .layer(middleware::from_fn_with_state(state.clone(), guard))
            .with_state(state);
        let task = tokio::spawn(async move {
            let mut shutdown = rx;
            let served = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = shutdown.changed().await;
                })
                .await
                .map_err(|e| e.to_string());
            let stopped = tokio::task::spawn_blocking(move || {
                let _operation = operations
                    .lock()
                    .map_err(|_| "operation lock unavailable")?;
                manager.stop().map(|_| ())
            })
            .await
            .map_err(|e| e.to_string())?;
            served?;
            stopped
        });
        Ok(Self {
            addr,
            stop: tx,
            task: Some(task),
            closing,
        })
    }
    pub fn address(&self) -> SocketAddr {
        self.addr
    }
    pub async fn shutdown(mut self) -> Result<(), String> {
        self.closing.store(true, Ordering::SeqCst);
        let _ = self.stop.send(true);
        self.task
            .take()
            .expect("server task")
            .await
            .map_err(|e| e.to_string())?
    }
}
impl Drop for ApiServer {
    fn drop(&mut self) {
        self.closing.store(true, Ordering::SeqCst);
        let _ = self.stop.send(true);
    }
}

async fn guard(State(app): State<App>, req: Request, next: Next) -> Response {
    let headers = req.headers();
    if headers.get_all(header::HOST).iter().count() != 1
        || headers.get_all(header::ORIGIN).iter().count() > 1
        || headers.get_all(header::AUTHORIZATION).iter().count() > 1
    {
        return api_error(StatusCode::FORBIDDEN, "ambiguous security headers");
    }
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if host != format!("127.0.0.1:{}", app.port) && host != format!("localhost:{}", app.port) {
        return api_error(StatusCode::FORBIDDEN, "invalid host");
    }
    let origin = match headers.get(header::ORIGIN) {
        Some(v) => match v.to_str() {
            Ok(v) if app.origins.iter().any(|x| x == v) => Some(v.to_string()),
            _ => return api_error(StatusCode::FORBIDDEN, "origin denied"),
        },
        None => None,
    };
    let cors_origin = origin
        .as_deref()
        .and_then(|v| HeaderValue::from_str(v).ok());
    if req.method() == Method::OPTIONS {
        if cors_origin.is_none() {
            return api_error(StatusCode::FORBIDDEN, "origin required");
        }
        let mut response = StatusCode::NO_CONTENT.into_response();
        add_cors(response.headers_mut(), cors_origin);
        return response;
    }
    let is_ws = req.uri().path() == "/v1/stream" && req.method() == Method::GET;
    let browser_public = app.frontend.is_some()
        && ((req.method() == Method::GET && !req.uri().path().starts_with("/v1/"))
            || (req.method() == Method::POST && req.uri().path() == "/session"));
    if !is_ws && !browser_public {
        let auth = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "));
        if !auth.is_some_and(|v| constant_eq(v, &app.token)) {
            let mut response = api_error(StatusCode::UNAUTHORIZED, "authentication required");
            if cors_origin.is_some() {
                add_cors(response.headers_mut(), cors_origin);
            }
            response
                .headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            return response;
        }
    }
    let mut shutdown = app.stop.clone();
    let mut response = tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(20), next.run(req)) => match result {
            Ok(response) => response,
            Err(_) => api_error(StatusCode::REQUEST_TIMEOUT, "request timed out"),
        },
        _ = shutdown.changed() => {
            let mut response = api_error(StatusCode::SERVICE_UNAVAILABLE, "server shutting down");
            response.headers_mut().insert(header::CONNECTION, HeaderValue::from_static("close"));
            response
        },
    };
    if (response.status().is_client_error() || response.status().is_server_error())
        && !response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|x| x.to_str().ok())
            .is_some_and(|x| x.starts_with("application/json"))
    {
        let status = response.status();
        response = api_error(
            status,
            status.canonical_reason().unwrap_or("request failed"),
        );
    }
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    if cors_origin.is_some() {
        add_cors(response.headers_mut(), cors_origin);
    }
    response
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Bootstrap {
    nonce: String,
}

async fn browser_session(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<Bootstrap>,
) -> Response {
    let expected_origin = format!("http://127.0.0.1:{}", app.port);
    if app.frontend.is_none()
        || headers.get(header::ORIGIN).and_then(|x| x.to_str().ok())
            != Some(expected_origin.as_str())
    {
        return api_error(StatusCode::FORBIDDEN, "same origin required");
    }
    let mut nonce = app.nonce.lock().unwrap();
    if !nonce
        .as_deref()
        .is_some_and(|n| constant_eq(n, &body.nonce))
    {
        return api_error(StatusCode::UNAUTHORIZED, "invalid or consumed bootstrap");
    }
    *nonce = None;
    Json(json!({"api_version": API_VERSION, "token": &*app.token})).into_response()
}

async fn static_frontend(State(app): State<App>, req: Request) -> Response {
    let Some(root) = app.frontend else {
        return api_error(StatusCode::NOT_FOUND, "not found");
    };
    if req.method() != Method::GET {
        return api_error(StatusCode::NOT_FOUND, "not found");
    }
    let path = req.uri().path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    if path
        .split('/')
        .any(|s| s.is_empty() || s == "." || s == ".." || s.contains('%') || s.contains('\\'))
    {
        return api_error(StatusCode::NOT_FOUND, "not found");
    }
    let file = match fs::canonicalize(root.join(path)) {
        Ok(p) if p.starts_with(&root) && p.is_file() => p,
        _ => return api_error(StatusCode::NOT_FOUND, "not found"),
    };
    let mime = match file.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    };
    match fs::read(file) { Ok(data) => ([(header::CONTENT_TYPE, mime), (header::CONTENT_SECURITY_POLICY, "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'")], data).into_response(), Err(_) => api_error(StatusCode::NOT_FOUND, "not found") }
}
fn add_cors(headers: &mut HeaderMap, origin: Option<HeaderValue>) {
    if let Some(value) = origin {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
    }
    headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("authorization, content-type"),
    );
}
fn api_error(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(json!({"api_version": API_VERSION, "error": message})),
    )
        .into_response()
}
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, Response> {
    match tokio::task::spawn_blocking(f).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(e)) => Err(api_error(StatusCode::BAD_REQUEST, &e)),
        Err(_) => Err(api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime operation failed",
        )),
    }
}
async fn board(State(app): State<App>) -> Json<Value> {
    Json(json!({"api_version":API_VERSION, "board":app.manager.board_profile()}))
}
async fn configuration(State(app): State<App>) -> Json<Value> {
    Json(json!({"api_version":API_VERSION,"config":*app.last_config.lock().unwrap()}))
}
async fn status(State(app): State<App>) -> Response {
    match blocking(move || Ok(app.manager.status())).await {
        Ok(s) => Json(json!({"api_version":API_VERSION,"status":s})).into_response(),
        Err(e) => e,
    }
}
async fn logs(State(app): State<App>) -> Json<Value> {
    Json(json!({"api_version":API_VERSION, "logs":app.manager.logs()}))
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
enum StartRequest {
    Simulator {
        battery_percent: u8,
        brightness_percent: u8,
        accel_x: f32,
        time_ms: u64,
    },
    Firmware {
        flash_mb: u16,
        psram_mb: u16,
        image_id: String,
    },
}
async fn start(State(app): State<App>, Json(req): Json<StartRequest>) -> Response {
    let last_config = req.clone();
    let config = match req {
        StartRequest::Simulator {
            battery_percent,
            brightness_percent,
            accel_x,
            time_ms,
        } => RuntimeConfig::Simulator {
            battery_percent,
            brightness_percent,
            accel_x,
            time_ms,
        },
        StartRequest::Firmware {
            flash_mb,
            psram_mb,
            image_id,
        } => {
            let images = if image_id == "default" {
                Some(app.manager.default_firmware_images())
            } else {
                app.images.lock().unwrap().get(&image_id).cloned()
            };
            let Some(images) = images else {
                return api_error(StatusCode::NOT_FOUND, "unknown firmware image id");
            };
            RuntimeConfig::Firmware {
                flash_mb,
                psram_mb,
                images,
            }
        }
    };
    let manager = app.manager.clone();
    let operations = app.operations.clone();
    let closing = app.closing.clone();
    let remembered = app.last_config.clone();
    match blocking(move || {
        let _operation = operations
            .lock()
            .map_err(|_| "operation lock unavailable")?;
        if closing.load(Ordering::SeqCst) {
            return Err("server is shutting down".into());
        }
        let status = manager.start(config)?;
        *remembered.lock().map_err(|_| "config lock unavailable")? = Some(last_config);
        Ok(status)
    })
    .await
    {
        Ok(s) => Json(json!({"api_version":API_VERSION,"status":s})).into_response(),
        Err(e) => e,
    }
}
async fn stop_runtime(State(app): State<App>) -> Response {
    match blocking(move || {
        let _operation = app
            .operations
            .lock()
            .map_err(|_| "operation lock unavailable")?;
        app.manager.stop()
    })
    .await
    {
        Ok(s) => Json(json!({"api_version":API_VERSION,"status":s})).into_response(),
        Err(e) => e,
    }
}
async fn frame(State(app): State<App>) -> Response {
    match blocking(move || app.manager.snapshot()).await {
        Ok(f) => Json(json!({"api_version":API_VERSION,"frame":f})).into_response(),
        Err(e) => e,
    }
}
async fn touch(State(app): State<App>, Json(req): Json<TouchRequest>) -> Response {
    match blocking(move || app.manager.touch(req)).await {
        Ok(()) => Json(json!({"api_version":API_VERSION,"ok":true})).into_response(),
        Err(e) => e,
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Upload {
    bootloader_base64: String,
    partition_table_base64: String,
    app_base64: String,
    elf_base64: Option<String>,
}
#[derive(Serialize)]
struct UploadResult {
    api_version: u32,
    image_id: String,
}
async fn upload(State(app): State<App>, Json(req): Json<Upload>) -> Response {
    match blocking(move || store_images(&app, req)).await {
        Ok(image_id) => (
            StatusCode::CREATED,
            Json(UploadResult {
                api_version: API_VERSION,
                image_id,
            }),
        )
            .into_response(),
        Err(e) => e,
    }
}
fn store_images(app: &App, req: Upload) -> Result<String, String> {
    let decode = |s: &str| -> Result<Vec<u8>, String> {
        if s.len() > (MAX_UPLOAD * 4 / 3 + 8) {
            return Err("image exceeds size limit".into());
        }
        let b = STANDARD.decode(s).map_err(|_| "invalid base64")?;
        if b.len() > MAX_UPLOAD {
            return Err("image exceeds size limit".into());
        }
        Ok(b)
    };
    let boot = decode(&req.bootloader_base64)?;
    let partitions = decode(&req.partition_table_base64)?;
    let binary = decode(&req.app_base64)?;
    let elf = req.elf_base64.as_deref().map(decode).transpose()?;
    if boot.first() != Some(&0xe9) || binary.first() != Some(&0xe9) || partitions.len() < 32 {
        return Err("invalid firmware image headers".into());
    }
    if elf.as_ref().is_some_and(|e| !e.starts_with(b"\x7fELF")) {
        return Err("invalid ELF header".into());
    }
    let mut images = app
        .images
        .lock()
        .map_err(|_| "image registry unavailable")?;
    if images.len() >= MAX_IMAGES {
        return Err("firmware upload limit reached".into());
    }
    let id = generate_token()?;
    let dir = app.storage.path().join(&id);
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let write = |name: &str, data: &[u8]| -> Result<PathBuf, String> {
        let p = dir.join(name);
        fs::write(&p, data).map_err(|e| e.to_string())?;
        Ok(p)
    };
    let entry = FirmwareImages {
        bootloader: write("bootloader.bin", &boot)?,
        partition_table: write("partitions.bin", &partitions)?,
        app: write("app.bin", &binary)?,
        elf: elf
            .as_deref()
            .map(|data| write("app.elf", data))
            .transpose()?,
    };
    images.insert(id.clone(), entry);
    Ok(id)
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum WsCommand {
    Subscribe {
        #[serde(default)]
        status: bool,
        #[serde(default)]
        logs: bool,
        #[serde(default)]
        frames: bool,
        #[serde(default)]
        frame_rate: Option<u8>,
    },
    Touch {
        request: TouchRequest,
    },
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WsAuth {
    #[serde(rename = "type")]
    kind: String,
    token: String,
}
async fn stream(State(app): State<App>, ws: WebSocketUpgrade) -> Response {
    let permit = match app.connections.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => return api_error(StatusCode::TOO_MANY_REQUESTS, "connection limit reached"),
    };
    ws.max_message_size(4096)
        .max_frame_size(4096)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            ws_session(socket, app).await;
        })
}
async fn ws_send(socket: &mut WebSocket, message: Message) -> bool {
    matches!(
        tokio::time::timeout(Duration::from_secs(2), socket.send(message)).await,
        Ok(Ok(()))
    )
}
async fn ws_session(mut socket: WebSocket, app: App) {
    let auth = tokio::time::timeout(Duration::from_secs(3), socket.recv()).await;
    let valid = match auth {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<WsAuth>(&text)
            .ok()
            .is_some_and(|v| v.kind == "auth" && constant_eq(&v.token, &app.token)),
        _ => false,
    };
    if !valid {
        let _ = ws_send(&mut socket, Message::Close(None)).await;
        return;
    }
    if !ws_send(
        &mut socket,
        Message::Text(
            json!({"type":"authenticated","api_version":API_VERSION})
                .to_string()
                .into(),
        ),
    )
    .await
    {
        return;
    }
    let mut ticker = tokio::time::interval(Duration::from_millis(100));
    let mut shutdown = app.stop.clone();
    let (mut want_status, mut want_logs, mut want_frames) = (false, false, false);
    let (mut last_status, mut last_logs) = (String::new(), String::new());
    let mut last_frame: Vec<u8> = Vec::new();
    let mut session_touch: Option<(u16, u16)> = None;
    loop {
        tokio::select! {
            _ = shutdown.changed() => { let _ = ws_send(&mut socket, Message::Close(None)).await; break; }
            msg = socket.recv() => match msg {
                Some(Ok(Message::Text(text))) => match serde_json::from_str::<WsCommand>(&text) {
                    Ok(WsCommand::Subscribe { status, logs, frames, frame_rate }) => {
                        let fps = frame_rate.unwrap_or(10);
                        if !(1..=30).contains(&fps) { if !ws_send(&mut socket, Message::Text(json!({"type":"error","error":"frame_rate must be between 1 and 30"}).to_string().into())).await { break; } continue; }
                        ticker = tokio::time::interval(Duration::from_micros(1_000_000 / u64::from(fps)));
                        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                        want_status = status; want_logs = logs; want_frames = frames; last_status.clear(); last_logs.clear(); last_frame.clear();
                    }
                    Ok(WsCommand::Touch { request }) => {
                        let point = (request.x, request.y);
                        let action = request.action;
                        let manager = app.manager.clone();
                        let outcome = tokio::task::spawn_blocking(move || manager.touch(request)).await;
                        if matches!(&outcome, Ok(Ok(()))) {
                            match action { crate::TouchAction::Press => session_touch = Some(point), crate::TouchAction::Move if session_touch.is_some() => session_touch = Some(point), crate::TouchAction::Release => session_touch = None, _ => () }
                        }
                        let response = match outcome { Ok(Ok(())) => json!({"type":"touch_result","ok":true}), Ok(Err(e)) => json!({"type":"touch_result","ok":false,"error":e}), Err(_) => json!({"type":"touch_result","ok":false,"error":"runtime operation failed"}) };
                        if !ws_send(&mut socket, Message::Text(response.to_string().into())).await { break; }
                    }
                    Err(_) => { if !ws_send(&mut socket, Message::Text(json!({"type":"error","error":"invalid message"}).to_string().into())).await { break; } }
                },
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => (),
            },
            _ = ticker.tick() => {
                if want_status {
                    let manager = app.manager.clone();
                    if let Ok(status) = tokio::task::spawn_blocking(move || manager.status()).await {
                        let event = json!({"type":"status","status":status}).to_string();
                        if event != last_status { last_status = event.clone(); if !ws_send(&mut socket, Message::Text(event.into())).await { break; } }
                    }
                }
                if want_logs {
                    let event = json!({"type":"logs","logs":app.manager.logs()}).to_string();
                    if event != last_logs { last_logs = event.clone(); if !ws_send(&mut socket, Message::Text(event.into())).await { break; } }
                }
                if want_frames {
                    let manager = app.manager.clone();
                    if let Ok(Ok(raw)) = tokio::task::spawn_blocking(move || manager.snapshot_raw()).await {
                        if raw != last_frame {
                            last_frame = raw;
                            let to_encode = last_frame.clone();
                            if let Ok(Ok(frame)) = tokio::task::spawn_blocking(move || crate::frame_to_png(&to_encode)).await {
                                if !ws_send(&mut socket, Message::Text(json!({"type":"frame","frame":frame}).to_string().into())).await { break; }
                            }
                        }
                    }
                }
            }
        }
    }
    if let Some((x, y)) = session_touch {
        let manager = app.manager.clone();
        let result = tokio::task::spawn_blocking(move || {
            manager.touch(TouchRequest {
                action: crate::TouchAction::Release,
                x,
                y,
            })
        })
        .await;
        if !matches!(result, Ok(Ok(()))) {
            eprintln!("could not release touch after WebSocket disconnect");
        }
    }
}
