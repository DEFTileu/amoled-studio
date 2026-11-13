import type { ReactNode } from 'react';
import type { Mode } from '../types';
import { IconChip, IconCog, IconFile, IconFolder, IconMonitor, IconSliders } from './icons';

function Nav({ icon, label, open, current, onClick }: { icon: ReactNode; label: string; open: boolean; current?: boolean; onClick: () => void }) {
  return <button className="nav" aria-current={!!current} onClick={onClick} title={label}>{icon}{open && <span>{label}</span>}</button>;
}

export interface SidebarProps {
  open: boolean; mode: Mode; setMode: (m: Mode) => void; backend: 'ok' | 'down' | 'pending';
  onFirmware: () => void; onDevice: () => void; onSettings: () => void; onContract: () => void;
}

export function Sidebar(p: SidebarProps) {
  const { open } = p;
  const dot = { ok: 'var(--ok)', down: 'var(--err)', pending: 'var(--warn)' }[p.backend];
  return (
    <nav aria-label="Sidebar" className="side" style={{ width: open ? 196 : 48 }}>
      <Nav icon={<IconFolder />} label="Workspace" open={open} current onClick={() => {}} />
      {open && <div className="lbl">Runtime</div>}
      <Nav icon={<IconMonitor />} label="LVGL Simulator" open={open} current={p.mode === 'simulator'} onClick={() => p.setMode('simulator')} />
      <Nav icon={<IconChip />} label="Firmware Emulator" open={open} current={p.mode === 'firmware'} onClick={() => p.setMode('firmware')} />
      <Nav icon={<IconFile />} label="Firmware files" open={open} onClick={p.onFirmware} />
      {open && <div className="lbl">Configure</div>}
      <Nav icon={<IconSliders />} label="Device settings" open={open} onClick={p.onDevice} />
      <Nav icon={<IconCog />} label="Application settings" open={open} onClick={p.onSettings} />
      <span style={{ flex: 1 }} />
      <button className="nav" onClick={p.onContract} title="Runtime API contract">
        <span className="dot" style={{ margin: '0 4px', flex: 'none', background: dot }} />
        {open && <span>{{ ok: 'Backend: connected', down: 'Backend: unavailable', pending: 'Backend: connecting…' }[p.backend]}</span>}
      </button>
    </nav>
  );
}
