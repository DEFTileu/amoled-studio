// Firmware frames: byte 1, u16le width, u16le height, then little-endian RGB565 (runtime/README.md).
export const W = 466;
export const H = 466;

const L5 = Uint8Array.from({ length: 32 }, (_, i) => Math.floor((i * 255) / 31));
const L6 = Uint8Array.from({ length: 64 }, (_, i) => Math.floor((i * 255) / 63));

/** Decode a frame into RGBA `out`. Returns whether any pixel is non-black, or null for an invalid frame. */
export function decodeRgb565(buf: ArrayBuffer, out: Uint8ClampedArray): boolean | null {
  const v = new DataView(buf);
  if (buf.byteLength !== 5 + W * H * 2 || v.getUint8(0) !== 1 || v.getUint16(1, true) !== W || v.getUint16(3, true) !== H) return null;
  let lit = 0;
  for (let i = 0, o = 0, p = 5; i < W * H; i++, o += 4, p += 2) {
    const px = v.getUint16(p, true);
    out[o] = L5[px >> 11]; out[o + 1] = L6[(px >> 5) & 63]; out[o + 2] = L5[px & 31]; out[o + 3] = 255;
    lit |= px;
  }
  return lit !== 0;
}

/** Display-local pixel under a pointer, or null when outside the round glass (same test as the backend). */
export function toPixel(clientX: number, clientY: number, r: { left: number; top: number; width: number; height: number }) {
  const x = Math.min(W - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * W)));
  const y = Math.min(H - 1, Math.max(0, Math.floor(((clientY - r.top) / r.height) * H)));
  const dx = 2 * x + 1 - W, dy = 2 * y + 1 - H;
  return { x, y, inside: dx * dx + dy * dy <= W * H };
}

/** Holds the latest firmware frame in an offscreen canvas shared by the 2D view and the 3D texture. */
export class FrameStore {
  readonly canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  private ctx = this.canvas.getContext('2d')!;
  private img = this.ctx.createImageData(W, H);
  private pending: ArrayBuffer | null = null;
  private raf = 0;
  private subs = new Set<() => void>();
  onContent: (() => void) | null = null;

  constructor() { this.clear(); }
  subscribe(fn: () => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  private emit() { this.subs.forEach((f) => f()); }
  clear() { cancelAnimationFrame(this.raf); this.raf = 0; this.pending = null; this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, W, H); this.emit(); }
  /** Coalesces to one decode+paint per animation frame, so a fast stream never queues work. */
  push(buf: ArrayBuffer) {
    this.pending = buf;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const b = this.pending; this.pending = null;
      if (!b) return;
      const lit = decodeRgb565(b, this.img.data);
      if (lit === null) return;
      this.ctx.putImageData(this.img, 0, 0);
      this.emit();
      if (lit) this.onContent?.();
    });
  }
}
