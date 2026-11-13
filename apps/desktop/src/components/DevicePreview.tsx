import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { toPixel, type FrameStore } from '../runtime/frame';
import type { TouchSender } from '../runtime/touch';
import type { Run } from '../runtime/useRuntime';
import type { Mode } from '../types';

export interface TouchInfo { x: number; y: number; down: boolean; has: boolean }
const corner = (pos: Record<string, number | string>) => ({ position: 'absolute', width: 11, height: 11, ...pos } as const);
const tick = { background: 'linear-gradient(var(--muted),var(--muted)) 0 5px/11px 1px no-repeat' };
const ghost = { color: '#fff', borderColor: 'rgba(255,255,255,.35)', fontSize: '3.4cqw', height: 'auto', padding: '1.2cqw 3cqw' } as const;

export interface DevicePreviewProps {
  store: FrameStore; sender: TouchSender; run: Run; mode: Mode; canTouch: boolean; noConfig: boolean; blockedReason: string | null; error: string;
  onStart: () => void; onRestart: () => void; onConsole: () => void; onTouch: (t: TouchInfo) => void;
}

/** The 466 × 466 round display. Pixels are drawn from the live firmware framebuffer; the canvas is scaled by CSS only. */
export function DevicePreview(p: DevicePreviewProps) {
  const dispRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const [scale, setScale] = useState(1);
  const [ptr, setPtr] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const draw = () => canvasRef.current?.getContext('2d')?.drawImage(p.store.canvas, 0, 0);
    draw();
    return p.store.subscribe(draw);
  }, [p.store]);

  useEffect(() => {
    const el = dispRef.current!;
    const ro = new ResizeObserver(() => setScale(Math.round((el.clientWidth / 466) * 100) / 100));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const at = (e: PointerEvent<HTMLCanvasElement>) => toPixel(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!p.canTouch) return;
    const pt = at(e);
    if (!pt.inside) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    p.sender.press(pt.x, pt.y);
    p.onTouch({ x: pt.x, y: pt.y, down: true, has: true });
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const pt = at(e);
    setPtr(pt.inside ? pt : null);
    if (!dragging.current) return;
    p.sender.moveTo(pt.x, pt.y);
    p.onTouch({ x: pt.x, y: pt.y, down: true, has: true });
  };
  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const pt = at(e);
    p.sender.release(pt.x, pt.y);
    p.onTouch({ x: pt.x, y: pt.y, down: false, has: true });
  };

  const sim = p.mode === 'simulator';
  const hint = sim ? 'The LVGL simulator draws in its own SDL window; its framebuffer is not exposed to Studio.'
    : p.blockedReason ? p.blockedReason : p.noConfig ? 'Choose firmware images, then start the emulator.' : 'Press start to run. Click and drag on the screen to touch.';
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
      <div style={{ position: 'relative', width: 'min(calc(100cqw - 72px),calc(100cqh - 96px))', minWidth: 200, aspectRatio: '1', border: '1px solid var(--line)', marginTop: -10 }}>
        <i style={{ ...corner({ left: -6, top: -6 }), borderLeft: '1px solid var(--muted)', ...tick }} />
        <i style={{ ...corner({ right: -6, top: -6 }), borderRight: '1px solid var(--muted)', ...tick }} />
        <i style={{ ...corner({ left: -6, bottom: -6 }), borderLeft: '1px solid var(--muted)', ...tick }} />
        <i style={{ ...corner({ right: -6, bottom: -6 }), borderRight: '1px solid var(--muted)', ...tick }} />
        <div style={{ position: 'absolute', inset: '2.5%', borderRadius: '50%', background: 'linear-gradient(145deg,var(--surface),var(--line))', padding: '2.4%', boxShadow: '0 6px 24px rgba(0,0,0,.18)' }}>
          <div ref={dispRef} style={{ position: 'relative', width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', background: '#000', containerType: 'inline-size', touchAction: 'none' }}>
            <canvas ref={canvasRef} width={466} height={466} aria-label="Device display, 466 by 466"
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setPtr(null)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: scale >= 1 ? 'pixelated' : 'auto', cursor: p.canTouch ? 'pointer' : 'default' }} />
            {p.run === 'stopped' && (
              <div className="overlay" style={{ gap: '3cqw', padding: '14cqw' }}>
                <button onClick={p.onStart} disabled={p.noConfig} aria-label="Start runtime"
                  style={{ width: '16cqw', height: '16cqw', borderRadius: '50%', border: '1px solid rgba(255,255,255,.35)', background: 'transparent', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', opacity: p.noConfig ? 0.4 : 1 }}>
                  <svg width="40%" height="40%" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20" /></svg>
                </button>
                <div style={{ fontSize: '5.2cqw', fontWeight: 500, color: '#fff' }}>{p.blockedReason ? 'Backend unavailable' : p.noConfig ? 'Select firmware' : sim ? 'LVGL Simulator' : 'Firmware Emulator'}</div>
                <div style={{ fontSize: '3.6cqw', lineHeight: 1.4, maxWidth: '70cqw' }}>{hint}</div>
              </div>
            )}
            {p.run === 'starting' && (
              <div className="overlay" style={{ gap: '4cqw' }}>
                <div style={{ width: '9cqw', height: '9cqw', border: '2px solid rgba(255,255,255,.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .9s linear infinite' }} />
                <div style={{ fontSize: '4.4cqw' }}>{sim ? 'Starting simulator…' : 'Booting firmware…'}</div>
              </div>
            )}
            {p.run === 'running' && sim && (
              <div className="overlay" style={{ gap: '2.5cqw', padding: '16cqw', pointerEvents: 'none' }}>
                <div style={{ fontSize: '4.6cqw', color: '#fff' }}>Simulator running</div>
                <div style={{ fontSize: '3.4cqw', lineHeight: 1.4 }}>{hint}</div>
              </div>
            )}
            {p.run === 'error' && (
              <div className="overlay" style={{ gap: '3cqw', padding: '14cqw' }}>
                <div style={{ width: '9cqw', height: '9cqw', border: '1.5px solid oklch(.72 .15 25)', color: 'oklch(.72 .15 25)', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '5.5cqw' }}>!</div>
                <div style={{ fontSize: '5.2cqw', fontWeight: 500, color: '#fff' }}>Runtime error</div>
                <div style={{ fontSize: '3.2cqw', maxWidth: '70cqw', overflowWrap: 'anywhere', maxHeight: '22cqw', overflow: 'hidden' }}>{p.error}</div>
                <div style={{ display: 'flex', gap: '2cqw', marginTop: '1cqw' }}>
                  <button className="btn" onClick={p.onConsole} style={ghost}>View logs</button>
                  <button className="btn" onClick={p.onRestart} style={ghost}>Retry</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="caption" style={{ bottom: 14 }}>466 × 466 px · {scale.toFixed(2)}× · {ptr && p.run === 'running' ? `x ${ptr.x}  y ${ptr.y}` : 'pointer —'}</div>
    </div>
  );
}
