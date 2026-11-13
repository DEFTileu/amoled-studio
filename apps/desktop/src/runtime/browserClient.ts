// Browser transport: the same-origin v1 HTTP/WebSocket API (runtime/HTTP_API.md, runtime/contracts/http-v1.ts).
// Started by `amoled-studio serve --open`, which serves this frontend and hands the page a one-use bootstrap nonce in the URL
// fragment. The nonce is removed from the address bar, exchanged once (POST /session) for the API bearer token, and the token is
// kept in memory and in sessionStorage (cleared when the tab closes). It is never put in a URL, a log line or localStorage.
import type { BoardProfile, FirmwareImages, FrameSnapshot, LogEntry, RuntimeConfig, RuntimeStatus, TouchRequest } from '@contracts/v1';
import type { StartRequest } from '@contracts/http-v1';
import type { RuntimeClient } from './client';

export interface PickedFile { name: string; bytes: Uint8Array }

/** Everything the adapter needs from the page; injectable so the real backend can be tested from Node. */
export interface BrowserEnv {
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Origin of the page and API, e.g. http://127.0.0.1:49152. */
  origin: string;
  /** The page's current location.hash and pathname+search; the bootstrap fragment is read from here. */
  hash: string;
  cleanPath: string;
  replaceUrl(path: string): void;
  /** PNG (base64) -> frame in the documented RGB565 wire format (byte 1, u16le w, u16le h, pixels). */
  decodePng(base64: string): Promise<ArrayBuffer>;
  chooseFile(): Promise<PickedFile | null>;
  download(name: string, bytes: Uint8Array): void;
}

const SESSION_KEY = 'amoled-studio-session-v1';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // server cap per decoded image (HTTP_API.md)
const DEFAULT_IMAGES: FirmwareImages = { bootloader: 'default', partition_table: 'default', app: 'default', elf: null };
const isDefault = (i: FirmwareImages) => i.bootloader === 'default' && i.partition_table === 'default' && i.app === 'default' && (i.elf === null || i.elf === 'default' || i.elf === '');

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Serial, latest-wins frame delivery: PNG decoding is async, so frames must not overtake each other. */
function makeSink(env: BrowserEnv, onFrame: (frame: ArrayBuffer) => void) {
  let busy = false, closed = false, pending: string | null = null, last = '';
  const run = async (png: string) => {
    busy = true;
    try { const frame = await env.decodePng(png); if (!closed) onFrame(frame); } catch { /* a bad frame is dropped, the next one replaces it */ }
    busy = false;
    if (pending !== null && !closed) { const next = pending; pending = null; void run(next); }
  };
  return {
    push(frame: FrameSnapshot) {
      if (closed || frame.data_base64 === last) return;
      last = frame.data_base64;
      if (busy) pending = frame.data_base64; else void run(frame.data_base64);
    },
    close() { closed = true; },
  };
}

export function createBrowserClient(getEnv: () => BrowserEnv): RuntimeClient {
  let env: BrowserEnv | null = null;
  const e = () => (env ??= getEnv());

  // --- session: nonce (fragment) -> token, exactly once per launch ---
  let session: Promise<string> | null = null;
  const token = () => (session ??= (async () => {
    const nonce = new URLSearchParams(e().hash.replace(/^#/, '')).get('bootstrap');
    if (nonce) {
      e().replaceUrl(e().cleanPath); // drop the nonce from the address bar before anything else
      const r = await e().fetch(`${e().origin}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce }) });
      if (!r.ok) throw new Error('Local session initialization failed. Restart AMOLED Studio.');
      const t = (await r.json()).token as string;
      e().storage.setItem(SESSION_KEY, t);
      return t;
    }
    const stored = e().storage.getItem(SESSION_KEY);
    if (stored) return stored;
    throw new Error('No local session. Launch AMOLED Studio with `amoled-studio serve --open`.');
  })());

  async function call<T>(path: string, body?: unknown): Promise<T> {
    const t = await token();
    const post = body !== undefined;
    const res = await e().fetch(`${e().origin}${path}`, {
      method: post ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${t}`, ...(post ? { 'Content-Type': 'application/json' } : {}) },
      ...(post ? { body: JSON.stringify(body) } : {}),
    });
    let data: { error?: string } | null = null;
    try { data = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) {
      if (res.status === 401) e().storage.removeItem(SESSION_KEY);
      throw new Error(res.status === 401 ? 'Local session expired. Launch AMOLED Studio again.' : data?.error ?? `Runtime request failed (${res.status})`);
    }
    return data as T;
  }

  // --- firmware selection: the browser cannot give the server a path, so chosen files are uploaded once and referenced by image_id ---
  const files = new Map<string, Uint8Array>(); // handle "upload/<n>/<name>" -> bytes
  const uploaded = new Map<string, Promise<string>>(); // handles joined -> image_id (the server accepts only four uploads per lifetime)
  let counter = 0;
  const bytesOf = (handle: string | null, what: string) => {
    const b = handle ? files.get(handle) : undefined;
    if (!b) throw new Error(`${what}: choose a file with Browse… (the browser cannot read paths)`);
    return b;
  };
  async function imageId(images: FirmwareImages): Promise<string> {
    if (isDefault(images)) return 'default';
    const parts = { bootloader: bytesOf(images.bootloader, 'Bootloader'), partition_table: bytesOf(images.partition_table, 'Partition table'), app: bytesOf(images.app, 'Application'), elf: images.elf ? bytesOf(images.elf, 'ELF') : null };
    const key = [images.bootloader, images.partition_table, images.app, images.elf ?? ''].join('|');
    let id = uploaded.get(key);
    if (!id) {
      id = call<{ image_id: string }>('/v1/firmware', {
        bootloader_base64: toBase64(parts.bootloader), partition_table_base64: toBase64(parts.partition_table), app_base64: toBase64(parts.app), elf_base64: parts.elf && toBase64(parts.elf),
      }).then((r) => r.image_id);
      uploaded.set(key, id);
      id.catch(() => uploaded.delete(key)); // a rejected upload must be retryable
    }
    return id;
  }

  // --- frames: /v1/stream pushes changed PNGs about every 500 ms; a touch release additionally pulls one fresh frame so input feels immediate ---
  const sinks = new Set<ReturnType<typeof makeSink>>();
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const refreshSoon = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (!sinks.size) return;
      try { const { frame } = await call<{ frame: FrameSnapshot }>('/v1/frame'); sinks.forEach((s) => s.push(frame)); } catch { /* the stream still delivers it */ }
    }, 150);
  };

  return {
    transport: 'browser',
    boardProfile: async () => (await call<{ board: BoardProfile }>('/v1/board')).board,
    defaultImages: async () => DEFAULT_IMAGES,
    async start(config: RuntimeConfig) {
      const body: StartRequest = config.mode === 'simulator' ? config : { mode: 'firmware', flash_mb: config.flash_mb, psram_mb: config.psram_mb, image_id: await imageId(config.images) };
      return (await call<{ status: RuntimeStatus }>('/v1/runtime/start', body)).status;
    },
    stop: async () => (await call<{ status: RuntimeStatus }>('/v1/runtime/stop', {})).status,
    status: async () => (await call<{ status: RuntimeStatus }>('/v1/status')).status,
    logs: async () => (await call<{ logs: LogEntry[] }>('/v1/logs')).logs,
    capture: async () => (await call<{ frame: FrameSnapshot }>('/v1/frame')).frame,
    async touch(request: TouchRequest) {
      await call('/v1/touch', request);
      if (request.action === 'release') refreshSoon();
    },
    frames(status: RuntimeStatus, onFrame) {
      if (status.state !== 'running' || status.kind !== 'firmware') return () => {};
      const sink = makeSink(e(), onFrame);
      sinks.add(sink);
      let closed = false, ws: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, delay = 500;
      const connect = async () => {
        let t: string;
        try { t = await token(); } catch { return; }
        if (closed) return;
        const sock = (ws = new (e().WebSocket)(`${e().origin.replace(/^http/, 'ws')}/v1/stream`));
        sock.onopen = () => sock.send(JSON.stringify({ type: 'auth', token: t })); // the token travels in the first message, never in the URL
        sock.onmessage = (ev) => {
          let msg: { type?: string; frame?: FrameSnapshot };
          try { msg = JSON.parse(String(ev.data)); } catch { return; }
          if (msg.type === 'authenticated') { delay = 500; sock.send(JSON.stringify({ type: 'subscribe', frames: true })); }
          else if (msg.type === 'frame' && msg.frame) sink.push(msg.frame);
        };
        sock.onclose = () => { if (!closed) { retry = setTimeout(connect, delay); delay = Math.min(delay * 2, 5000); } };
      };
      void connect();
      return () => { closed = true; sink.close(); sinks.delete(sink); clearTimeout(retry); ws?.close(); };
    },
    canPickFile: true,
    async pickFile() {
      const f = await e().chooseFile();
      if (!f) return null;
      if (f.bytes.length === 0) throw new Error(`${f.name} is empty`);
      if (f.bytes.length > MAX_IMAGE_BYTES) throw new Error(`${f.name} is larger than the 8 MiB image limit`);
      const handle = `upload/${++counter}/${f.name}`;
      files.set(handle, f.bytes);
      return handle;
    },
    async saveFile(name, bytes) { e().download(name, bytes); return name; },
  };
}

// --- real DOM environment ---
async function decodePngInPage(base64: string): Promise<ArrayBuffer> {
  const image = new Image();
  image.src = `data:image/png;base64,${base64}`;
  await image.decode();
  if (image.width !== 466 || image.height !== 466) throw new Error('unexpected frame size');
  const canvas = document.createElement('canvas'); canvas.width = 466; canvas.height = 466;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, 466, 466).data;
  const out = new ArrayBuffer(5 + 466 * 466 * 2), view = new DataView(out);
  view.setUint8(0, 1); view.setUint16(1, 466, true); view.setUint16(3, 466, true);
  for (let i = 0; i < 466 * 466; i++) view.setUint16(5 + i * 2, ((px[i * 4] >> 3) << 11) | ((px[i * 4 + 1] >> 2) << 5) | (px[i * 4 + 2] >> 3), true);
  return out;
}

function chooseFileInPage(): Promise<PickedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.style.display = 'none';
    document.body.appendChild(input); // detached inputs can be collected before they fire
    const done = (v: PickedFile | null) => { input.remove(); resolve(v); };
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return done(null);
      try { done({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); } catch (err) { input.remove(); reject(err); }
    };
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

export const browserClient: RuntimeClient = createBrowserClient(() => ({
  fetch: window.fetch.bind(window),
  WebSocket: window.WebSocket,
  // sessionStorage can throw (blocked site data); the session then simply cannot survive a refresh.
  storage: {
    getItem: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    setItem: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* not persisted */ } },
    removeItem: (k) => { try { sessionStorage.removeItem(k); } catch { /* nothing stored */ } },
  },
  origin: location.origin,
  hash: location.hash,
  cleanPath: location.pathname + location.search,
  replaceUrl: (path) => history.replaceState(null, '', path),
  decodePng: decodePngInPage,
  chooseFile: chooseFileInPage,
  download(name, bytes) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' })), download: name });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
}));
