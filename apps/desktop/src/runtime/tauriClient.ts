// The only file (with main.tsx's dynamic import of it) that touches Tauri APIs.
import { Channel, invoke } from '@tauri-apps/api/core';
import { join, pictureDir } from '@tauri-apps/api/path';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { RuntimeClient } from './client';

/** Commands registered by amoled-runtime's `tauri-commands` feature (runtime/README.md). */
export const tauriClient: RuntimeClient = {
  transport: 'tauri',
  boardProfile: () => invoke('get_board_profile'),
  defaultImages: () => invoke('get_default_firmware_images'),
  start: (config) => invoke('start_runtime', { config }),
  stop: () => invoke('stop_runtime'),
  status: () => invoke('get_runtime_status'),
  logs: () => invoke('get_runtime_logs'),
  capture: () => invoke('capture_framebuffer'),
  touch: (request) => invoke('send_touch', { request }),
  // The emulator's WebSocket rejects browser origins (403 for tauri://localhost), so the Rust host relays frames over a channel.
  frames(s, onFrame) {
    if (s.state !== 'running' || s.kind !== 'firmware') return () => {};
    const channel = new Channel<ArrayBuffer | ArrayBufferView | number[]>();
    channel.onmessage = (m) => onFrame(m instanceof ArrayBuffer ? m : ArrayBuffer.isView(m) ? (m.buffer as ArrayBuffer).slice(m.byteOffset, m.byteOffset + m.byteLength) : new Uint8Array(m).buffer);
    let id: number | null = null, dead = false;
    invoke<number>('subscribe_frames', { onFrame: channel })
      .then((n) => { if (dead) void invoke('unsubscribe_frames', { id: n }); else id = n; })
      .catch(() => {}); // not running (yet): the status effect re-subscribes when it changes
    return () => { dead = true; if (id !== null) void invoke('unsubscribe_frames', { id }); };
  },
  canPickFile: true,
  async pickFile() { const f = await open({ multiple: false, directory: false }); return typeof f === 'string' ? f : null; },
  async saveFile(name, bytes) {
    const path = await save({ defaultPath: await join(await pictureDir(), name), filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!path) return null;
    await writeFile(path, bytes);
    return path;
  },
};
