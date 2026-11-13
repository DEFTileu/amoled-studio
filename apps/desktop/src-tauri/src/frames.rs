//! Frame relay. The emulator's WebSocket rejects browser Origins (403 for `tauri://localhost`), so a webview cannot connect
//! to it directly. This host connects natively (no Origin header) and forwards each binary frame over a Tauri channel.
//! The runtime owns the private viewer credentials; they never reach the webview.
use amoled_runtime::RuntimeManager;
use std::{
    collections::HashMap,
    io::ErrorKind,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering::SeqCst},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    State,
};
use tungstenite::Message;

#[derive(Default)]
pub struct Subscriptions {
    next: AtomicU32,
    live: Mutex<HashMap<u32, Arc<AtomicBool>>>,
}

fn relay(manager: Arc<RuntimeManager>, channel: Channel<InvokeResponseBody>, stop: Arc<AtomicBool>) {
    while !stop.load(SeqCst) {
        if let Ok(mut ws) = manager.connect_frame_stream() {
            let _ = ws.get_ref().set_read_timeout(Some(Duration::from_millis(300)));
            while !stop.load(SeqCst) {
                match ws.read() {
                    Ok(Message::Binary(frame)) => {
                        if channel.send(InvokeResponseBody::Raw(frame.to_vec())).is_err() {
                            return; // webview is gone
                        }
                    }
                    Ok(Message::Close(_)) => break,
                    Ok(_) => {}
                    Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                    Err(_) => break,
                }
            }
        }
        std::thread::sleep(Duration::from_millis(400)); // emulator not up yet or restarting: retry
    }
}

#[tauri::command]
pub fn subscribe_frames(manager: State<'_, Arc<RuntimeManager>>, subs: State<'_, Subscriptions>, on_frame: Channel<InvokeResponseBody>) -> Result<u32, String> {
    if manager.status().kind != Some(amoled_runtime::RuntimeKind::Firmware) || manager.status().state != amoled_runtime::State::Running { return Err("no frame stream: the firmware emulator is not running".into()); }
    let (id, stop) = (subs.next.fetch_add(1, SeqCst) + 1, Arc::new(AtomicBool::new(false)));
    subs.live.lock().map_err(|e| e.to_string())?.insert(id, Arc::clone(&stop));
    let manager = Arc::clone(manager.inner());
    std::thread::spawn(move || relay(manager, on_frame, stop));
    Ok(id)
}

#[tauri::command]
pub fn unsubscribe_frames(subs: State<'_, Subscriptions>, id: u32) {
    if let Some(stop) = subs.live.lock().ok().and_then(|mut m| m.remove(&id)) {
        stop.store(true, SeqCst);
    }
}
