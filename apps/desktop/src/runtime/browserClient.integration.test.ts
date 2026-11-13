// Runs the real browser adapter against the real `amoled-studio serve` launcher, emulator and firmware.
// Needs: `npm run build` (the launcher serves dist/), the built esp32sim + firmware, and STUDIO_RUNTIME_E2E=1.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FirmwareImages, RuntimeConfig } from '@contracts/v1';
import { createBrowserClient, type BrowserEnv, type PickedFile } from './browserClient';

const enabled = process.env.STUDIO_RUNTIME_E2E === '1';
const root = resolve(process.cwd(), '../..');
const bin = resolve(root, 'runtime/target/debug/amoled-studio');
const buildDir = resolve(root, 'firmware/esp-idf/build');

/** Minimal PNG reader (8-bit RGB/RGBA, non-interlaced) for the backend's frames. */
function readPng(b64: string) {
  const png = Buffer.from(b64, 'base64');
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  let off = 8, w = 0, h = 0, ct = 0; const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off), type = png.toString('ascii', off + 4, off + 8), data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; expect(data[8]).toBe(8); expect(data[12]).toBe(0); }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = ct === 2 ? 3 : 4, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x], a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      out[y * stride + x] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  return { w, h, bpp, px: out };
}
const toRgb565 = async (b64: string): Promise<ArrayBuffer> => {
  const { w, h, bpp, px } = readPng(b64);
  const out = new ArrayBuffer(5 + w * h * 2), v = new DataView(out);
  v.setUint8(0, 1); v.setUint16(1, w, true); v.setUint16(3, h, true);
  for (let i = 0; i < w * h; i++) v.setUint16(5 + i * 2, ((px[i * bpp] >> 3) << 11) | ((px[i * bpp + 1] >> 2) << 5) | (px[i * bpp + 2] >> 3), true);
  return out;
};
const pixel565 = (f: ArrayBuffer, x: number, y: number) => new DataView(f).getUint16(5 + (y * 466 + x) * 2, true);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => Promise<T | false | undefined> | T | false | undefined, ms = 30000): Promise<T> {
  const t = Date.now();
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}`); await sleep(100); }
}

describe.skipIf(!enabled)('browser adapter against the real amoled-studio launcher', () => {
  let child: ChildProcess, origin = '', nonce = '', token = '', stderr = '';
  const storage = new Map<string, string>();
  const requested: string[] = []; // every URL the adapter fetched
  let uploads = 0; // POST /v1/firmware count
  let nextFile: PickedFile | null = null;
  const downloads: { name: string; bytes: Uint8Array }[] = [];

  const env = (hash = ''): BrowserEnv => ({
    // Browsers add Origin themselves; Node's fetch does not.
    fetch: (input, init) => {
      const url = String(input); requested.push(url);
      if (url.endsWith('/v1/firmware')) uploads++;
      return fetch(input, { ...init, headers: { Origin: origin, ...(init?.headers as Record<string, string>) } });
    },
    WebSocket: globalThis.WebSocket,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v), removeItem: (k) => void storage.delete(k) },
    origin, hash, cleanPath: '/', replaceUrl: (p) => void replaced.push(p),
    decodePng: toRgb565,
    chooseFile: async () => nextFile,
    download: (name, bytes) => void downloads.push({ name, bytes }),
  });
  const replaced: string[] = [];
  const client = () => createBrowserClient(() => env());
  const fwConfig = (images: FirmwareImages): RuntimeConfig => ({ mode: 'firmware', flash_mb: 16, psram_mb: 8, images });
  const file = (n: string): PickedFile => ({ name: n, bytes: new Uint8Array(readFileSync(resolve(buildDir, n === 'bootloader.bin' ? 'bootloader/bootloader.bin' : n === 'partition-table.bin' ? 'partition_table/partition-table.bin' : n))) });
  const bootReady = (c: ReturnType<typeof client>) => waitFor('firmware ready marker', async () => (await c.logs()).some((l) => l.message.includes('AMOLED_FIRMWARE_LVGL_READY')), 60000);

  beforeAll(async () => {
    if (!existsSync(resolve(root, 'apps/desktop/dist/index.html'))) throw new Error('run `npm run build` first: the launcher serves apps/desktop/dist');
    execFileSync('cargo', ['build', '--locked', '--manifest-path', resolve(root, 'runtime/Cargo.toml'), '--bin', 'amoled-studio'], { stdio: 'inherit', timeout: 600000 });
    child = spawn(bin, ['serve', '--project', root, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr!.on('data', (d) => (stderr += d));
    const url = await new Promise<string>((ok, bad) => {
      let out = '';
      child.stdout!.on('data', (d) => { out += d; const m = /(http:\/\/127\.0\.0\.1:\d+\/#bootstrap=[0-9a-f]{64})/.exec(out); if (m) ok(m[1]); });
      child.on('exit', (c) => bad(new Error(`launcher exited ${c}: ${stderr}`)));
      setTimeout(() => bad(new Error('launcher printed no URL')), 20000);
    });
    const u = new URL(url); origin = u.origin; nonce = u.hash.replace('#bootstrap=', '');
  }, 700000);

  afterAll(async () => {
    child?.kill('SIGTERM');
    await new Promise((r) => { child?.on('exit', r); setTimeout(r, 10000); });
  });

  it('serves the production frontend with a restrictive CSP and keeps the API behind the token', async () => {
    const page = await fetch(origin + '/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root">');
    expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect((await fetch(origin + '/v1/status', { headers: { Origin: origin } })).status).toBe(401);
    expect((await fetch(origin + '/v1/status', { headers: { Origin: origin, Authorization: 'Bearer ' + '0'.repeat(64) } })).status).toBe(401);
    expect((await fetch(origin + '/v1/status', { headers: { Origin: 'http://evil.example' } })).status).toBe(403);
  });

  it('exchanges the one-use bootstrap nonce for a session without leaking either value', async () => {
    const first = createBrowserClient(() => env(`#bootstrap=${nonce}`));
    expect((await first.status()).state).toBe('stopped');
    expect(replaced).toEqual(['/']); // nonce removed from the address bar
    token = storage.get('amoled-studio-session-v1')!;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // a refresh (no fragment) reuses the stored session
    expect((await client().status()).state).toBe('stopped');
    // the nonce cannot be replayed
    storage.delete('amoled-studio-session-v1');
    await expect(createBrowserClient(() => env(`#bootstrap=${nonce}`)).status()).rejects.toThrow(/session initialization failed/);
    storage.set('amoled-studio-session-v1', token);
    // neither secret ever appeared in a request URL
    expect(requested.filter((u) => u.includes(token) || u.includes(nonce))).toEqual([]);
  });

  it('reports board and defaults', async () => {
    const c = client();
    expect(await c.boardProfile()).toMatchObject({ id: expect.stringContaining('amoled'), width: 466, height: 466, shape: 'round' });
    expect(await c.defaultImages()).toEqual({ bootloader: 'default', partition_table: 'default', app: 'default', elf: null });
  });

  it('runs the bundled firmware: lifecycle, logs, frames, touch, screenshot', async () => {
    const c = client();
    const started = await c.start(fwConfig(await c.defaultImages()));
    expect(started).toMatchObject({ state: 'running', kind: 'firmware', viewer_url: null });
    await bootReady(c);
    expect((await c.logs()).length).toBeGreaterThan(5);

    const frames: ArrayBuffer[] = [];
    const stop = c.frames(await c.status(), (f) => frames.push(f));
    await waitFor('first lit frame', () => frames.some((f) => pixel565(f, 233, 233) !== 0));
    const first = frames.at(-1)!;
    expect(first.byteLength).toBe(5 + 466 * 466 * 2);
    expect(pixel565(first, 2, 2)).toBe(0); // round glass: corner is black
    expect(pixel565(first, 233, 233)).not.toBe(0);

    const shot = await c.capture();
    expect(shot).toMatchObject({ width: 466, height: 466, format: 'png_base64' });
    expect(readPng(shot.data_base64)).toMatchObject({ w: 466, h: 466 });

    // touch rules from the backend are surfaced as errors
    await expect(c.touch({ action: 'press', x: 2, y: 2 })).rejects.toThrow(/outside/);
    await expect(c.touch({ action: 'release', x: 233, y: 263 })).rejects.toThrow(/invalid touch sequence/);

    // tapping the firmware's own button changes the screen, and the adapter pushes the new frame promptly
    const seen = frames.length;
    await c.touch({ action: 'press', x: 233, y: 263 });
    await sleep(80);
    await c.touch({ action: 'release', x: 233, y: 263 });
    const t0 = Date.now();
    await waitFor('frame after tap', () => frames.length > seen && Buffer.compare(Buffer.from(frames.at(-1)!), Buffer.from(first)) !== 0, 5000);
    expect(Date.now() - t0).toBeLessThan(2500);
    expect((await c.capture()).data_base64).not.toBe(shot.data_base64);

    // swipe: press, moves, release in order
    await c.touch({ action: 'press', x: 380, y: 233 });
    for (let x = 360; x >= 100; x -= 40) await c.touch({ action: 'move', x, y: 233 });
    await c.touch({ action: 'release', x: 92, y: 233 });

    // screenshots download through the adapter
    await c.saveFile('shot.png', Uint8Array.from(Buffer.from(shot.data_base64, 'base64')));
    expect(downloads.at(-1)!.name).toBe('shot.png');

    stop();
    const stopped = await c.stop();
    expect(stopped.state).toBe('stopped');
    expect((await c.status()).pid).toBeNull();
  }, 180000);

  it('uploads user-selected firmware once, reuses it on restart, and rejects bad input', async () => {
    const c = client();
    const picked: FirmwareImages = { bootloader: '', partition_table: '', app: '', elf: null };
    for (const [k, n] of [['bootloader', 'bootloader.bin'], ['partition_table', 'partition-table.bin'], ['app', 'amoled_studio_175c.bin']] as const) { nextFile = file(n); picked[k] = (await c.pickFile())!; }
    expect(picked.app).toBe('upload/3/amoled_studio_175c.bin');
    nextFile = null;
    expect(await c.pickFile()).toBeNull(); // cancelled chooser

    const before = uploads;
    expect(await c.start(fwConfig(picked))).toMatchObject({ state: 'running', kind: 'firmware' });
    expect(uploads - before).toBe(1);
    await bootReady(c);
    const frames: ArrayBuffer[] = [];
    const stop = c.frames(await c.status(), (f) => frames.push(f));
    await waitFor('lit frame from uploaded firmware', () => frames.some((f) => pixel565(f, 233, 233) !== 0));
    stop();
    await c.stop();

    expect(await c.start(fwConfig(picked))).toMatchObject({ state: 'running' }); // same selection: no second upload
    expect(uploads - before).toBe(1);
    await c.stop();

    // input the adapter or backend must refuse
    await expect(c.start(fwConfig({ bootloader: '/tmp/b.bin', partition_table: '/tmp/p.bin', app: '/tmp/a.bin', elf: null }))).rejects.toThrow(/Browse/);
    nextFile = { name: 'garbage.bin', bytes: new Uint8Array(100).fill(7) };
    const bad = { ...picked, bootloader: (await c.pickFile())! };
    await expect(c.start(fwConfig(bad))).rejects.toThrow();
    expect((await c.status()).state).not.toBe('running');
    nextFile = { name: 'huge.bin', bytes: new Uint8Array(8 * 1024 * 1024 + 1) };
    await expect(c.pickFile()).rejects.toThrow(/8 MiB/);
    nextFile = { name: 'empty.bin', bytes: new Uint8Array(0) };
    await expect(c.pickFile()).rejects.toThrow(/empty/);
    // a failed upload is retried, not cached as a failure
    await expect(c.start(fwConfig(bad))).rejects.toThrow();
  }, 240000);

  it('never sent the token in a URL', () => {
    expect(requested.filter((u) => u.includes(token))).toEqual([]);
    expect(requested.every((u) => u.startsWith(origin))).toBe(true);
  });
});
