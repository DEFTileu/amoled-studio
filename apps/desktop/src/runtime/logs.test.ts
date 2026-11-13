import { describe, expect, it } from 'vitest';
import { mergeBackend, parseLine } from './logs';
import { decodeRgb565, toPixel, W, H } from './frame';

const e = (m: string) => ({ stream: 'stdout' as const, message: m });

describe('logs', () => {
  it('finds only new lines', () => {
    expect(mergeBackend([e('a'), e('b')], [e('a'), e('b'), e('c')])).toEqual([e('c')]);
    expect(mergeBackend([e('a'), e('b')], [e('b'), e('c')])).toEqual([e('c')]); // window rotated
    expect(mergeBackend([], [e('x')])).toEqual([e('x')]);
    expect(mergeBackend([e('a')], [e('a')])).toEqual([]);
  });
  it('parses ESP-IDF levels and strips ANSI', () => {
    expect(parseLine(e('\x1b[0;31mE (12) tag: boom\x1b[0m'))).toEqual({ level: 'error', msg: 'E (12) tag: boom' });
    expect(parseLine(e('W (1) x: y')).level).toBe('warn');
    expect(parseLine(e('plain')).level).toBe('info');
  });
});

describe('frame', () => {
  it('decodes RGB565 little endian and rejects bad frames', () => {
    const b = new ArrayBuffer(5 + W * H * 2); const v = new DataView(b);
    v.setUint8(0, 1); v.setUint16(1, W, true); v.setUint16(3, H, true); v.setUint16(5, 0xf800, true);
    const out = new Uint8ClampedArray(W * H * 4);
    expect(decodeRgb565(b, out)).toBe(true);
    expect([...out.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(decodeRgb565(new ArrayBuffer(10), out)).toBeNull();
  });
  it('maps pointers and rejects the corners', () => {
    const r = { left: 100, top: 50, width: 233, height: 233 }; // 0.5x scale
    expect(toPixel(100 + 116.5, 50 + 116.5, r)).toMatchObject({ x: 233, y: 233, inside: true });
    expect(toPixel(100, 50, r).inside).toBe(false);
    expect(toPixel(0, 0, r)).toMatchObject({ x: 0, y: 0 });
    expect(toPixel(1e5, 1e5, r)).toMatchObject({ x: 465, y: 465 });
  });
});
