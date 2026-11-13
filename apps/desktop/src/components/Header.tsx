import type { Mode } from '../types';
import type { Run } from '../runtime/useRuntime';
import { IconCamera, IconInspector, IconPlay, IconRestart, IconSidebar, IconStop, IconSun } from './icons';

const STATUS = { stopped: ['var(--muted)', 'Stopped'], starting: ['var(--warn)', 'Starting…'], running: ['var(--ok)', 'Running'], error: ['var(--err)', 'Error'] } as const;

export interface HeaderProps {
  board: string; mode: Mode; setMode: (m: Mode) => void; run: Run; busy: boolean; noConfig: boolean;
  view: '2d' | '3d'; setView: (v: '2d' | '3d') => void; canShot: boolean;
  onStart: () => void; onStop: () => void; onRestart: () => void; onShot: () => void;
  onSidebar: () => void; onInspector: () => void; onTheme: () => void;
}

export function Header(p: HeaderProps) {
  const [color, label] = STATUS[p.run];
  const active = p.run === 'starting' || p.run === 'running';
  return (
    <header className="top">
      <button className="btn ib" aria-label="Toggle sidebar" title="Toggle sidebar" onClick={p.onSidebar}><IconSidebar /></button>
      <span className="brand">AMOLED Studio</span>
      <span className="vsep" />
      <span className="board" title="Board">{p.board}</span>
      <div className="seg" role="group" aria-label="Runtime mode" style={{ marginLeft: 8 }}>
        <button aria-pressed={p.mode === 'simulator'} onClick={() => p.setMode('simulator')} disabled={p.busy}>LVGL Simulator</button>
        <button aria-pressed={p.mode === 'firmware'} onClick={() => p.setMode('firmware')} disabled={p.busy}>Firmware Emulator</button>
      </div>
      <span style={{ flex: 1 }} />
      <span className="pill" role="status"><span className="dot" style={{ background: color }} />{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {!active
          ? <button className="btn pri" onClick={p.onStart} disabled={p.busy || p.noConfig} title="Start (⌘R restarts)"><IconPlay size={14} />Start</button>
          : <button className="btn" onClick={p.onStop} disabled={p.busy} title="Stop"><IconStop size={14} />Stop</button>}
        <button className="btn" onClick={p.onRestart} disabled={p.busy || (!active && p.noConfig)} title="Restart (⌘R)"><IconRestart size={14} />Restart</button>
      </div>
      <button className="btn ib" onClick={p.onShot} disabled={!p.canShot} aria-label="Screenshot"
        title={p.mode === 'simulator' ? 'Screenshots need the Firmware Emulator (the simulator exposes no framebuffer API)' : 'Save a 466 × 466 screenshot'}><IconCamera /></button>
      <div className="seg" role="group" aria-label="Preview dimension">
        <button aria-pressed={p.view === '2d'} onClick={() => p.setView('2d')}>2D</button>
        <button aria-pressed={p.view === '3d'} onClick={() => p.setView('3d')}>3D</button>
      </div>
      <span className="vsep" />
      <button className="btn ib" onClick={p.onTheme} title="Toggle theme" aria-label="Toggle theme"><IconSun /></button>
      <button className="btn ib" onClick={p.onInspector} title="Toggle inspector" aria-label="Toggle inspector"><IconInspector /></button>
    </header>
  );
}
