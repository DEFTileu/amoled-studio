import type { ReactNode } from 'react';
import type { FirmwareImages } from '@contracts/v1';
import type { Mode, SimCfg } from '../types';
import type { TouchInfo } from './DevicePreview';

const NA = 'Not supported by runtime API v1';
const base = (p?: string) => (p ? p.split('/').pop() : undefined);

function Sec({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return <div className="sec"><div className="row2" style={{ alignItems: 'center' }}><span className="lbl">{title}</span>{right}</div>{children}</div>;
}

export interface InspectorProps {
  mode: Mode; locked: boolean; touchLive: boolean; touch: TouchInfo;
  sim: SimCfg; setSim: (s: SimCfg) => void;
  flash: 16 | 32; setFlash: (f: 16 | 32) => void; flashOptions: number[]; images: FirmwareImages | null; onSelectFirmware: () => void;
}

export function Inspector(p: InspectorProps) {
  const sim = p.mode === 'simulator';
  const { sim: s } = p;
  const num = (v: string, d: number) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  return (
    <aside aria-label="Inspector" className="insp">
      <div className="row2" style={{ alignItems: 'center', padding: '10px 14px 6px' }}>
        <span style={{ font: '600 15px var(--head)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Inspector</span>
        <span className="badge" title="The runtime applies these values when it starts; changing them needs a restart.">Applied at start</span>
      </div>
      <div className="muted" style={{ padding: '0 14px 8px', fontSize: 12 }}>
        Showing settings supported by the {sim ? 'LVGL Simulator' : 'Firmware Emulator'}.{p.locked && ' Stop the runtime to edit them.'}
      </div>

      {sim ? <>
        <Sec title="Power">
          <label style={{ display: 'grid', gap: 4 }}><span className="row2"><span>Battery</span><span className="mono12">{s.battery}%</span></span>
            <input type="range" min={0} max={100} value={s.battery} disabled={p.locked} onChange={(e) => p.setSim({ ...s, battery: +e.target.value })} /></label>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} title={NA}><span className="muted">Charging</span><input type="checkbox" disabled /></label>
          <label style={{ display: 'grid', gap: 4 }}><span className="row2"><span>Brightness</span><span className="mono12">{s.brightness}%</span></span>
            <input type="range" min={0} max={100} value={s.brightness} disabled={p.locked} onChange={(e) => p.setSim({ ...s, brightness: +e.target.value })} /></label>
        </Sec>
        <Sec title="Virtual time">
          <label style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 8, alignItems: 'center' }}><span>Fixed ms</span>
            <input className="inp" type="number" min={0} step={1000} value={s.timeMs} disabled={p.locked} aria-label="Fixed mock time in milliseconds" onChange={(e) => p.setSim({ ...s, timeMs: Math.max(0, Math.round(num(e.target.value, 0))) })} /></label>
        </Sec>
        <Sec title="IMU">
          <div style={{ display: 'grid', gridTemplateColumns: '44px repeat(3,1fr)', gap: 6, alignItems: 'center', font: '12px var(--mono)' }}>
            <span className="muted">accel g</span>
            <input className="inp" type="number" step={0.1} value={s.accelX} disabled={p.locked} aria-label="Accel X" onChange={(e) => p.setSim({ ...s, accelX: num(e.target.value, 0) })} />
            <input className="inp" type="number" disabled title={NA} aria-label="Accel Y (unsupported)" /><input className="inp" type="number" disabled title={NA} aria-label="Accel Z (unsupported)" />
            <span className="muted">gyro °/s</span>
            {['X', 'Y', 'Z'].map((a) => <input key={a} className="inp" type="number" disabled title={NA} aria-label={`Gyro ${a} (unsupported)`} />)}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>Only accelerometer X is supported.</div>
        </Sec>
      </> : <>
        <Sec title="Flash configuration">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="mono12" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.images?.app}>{base(p.images?.app) ?? 'No firmware selected'}</span>
            <button className="btn" style={{ height: 24 }} onClick={p.onSelectFirmware}>Select…</button>
          </div>
          <label style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 8, alignItems: 'center' }}><span>Flash</span>
            <select className="inp" value={p.flash} disabled={p.locked} onChange={(e) => p.setFlash(+e.target.value as 16 | 32)}>
              {p.flashOptions.map((m) => <option key={m} value={m}>{m} MB</option>)}
            </select></label>
          <label style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 8, alignItems: 'center' }} title="The board profile fixes PSRAM at 8 MB"><span>PSRAM</span>
            <select className="inp" value={8} disabled><option value={8}>8 MB octal</option></select></label>
          <div className="muted" style={{ fontSize: 11.5 }}>Virtual sizes only. Battery, brightness, IMU and time are not configurable for firmware.</div>
        </Sec>
      </>}

      <Sec title="Touch input · CST9217">
        <div className="kv"><span className="muted">state</span><span>{!p.touchLive ? 'inactive' : p.touch.down ? 'pressed' : 'idle'}</span>
          <span className="muted">x, y</span><span>{p.touch.has ? `${p.touch.x}, ${p.touch.y}` : '—'}</span></div>
        {sim && <div className="muted" style={{ fontSize: 11.5 }}>Touch injection needs the Firmware Emulator; the simulator has no input API.</div>}
      </Sec>
    </aside>
  );
}
