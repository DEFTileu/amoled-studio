import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Level, Row } from '../runtime/logs';
import { IconChevron } from './icons';

const COLOR: Record<Level, string> = { error: 'var(--err)', warn: 'var(--warn)', info: 'var(--muted)' };
type Filter = 'all' | Level;

export interface ConsoleProps { rows: Row[]; open: boolean; height: number; setOpen: (o: boolean) => void; setHeight: (h: number) => void; onClear: () => void }

export function Console({ rows, open, height, setOpen, setHeight, onClear }: ConsoleProps) {
  const [level, setLevel] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [auto, setAuto] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const q = query.toLowerCase();
    return rows.filter((r) => (level === 'all' || r.level === level) && (!q || (r.msg + r.src).toLowerCase().includes(q)));
  }, [rows, level, query]);
  const warn = rows.filter((r) => r.level === 'warn').length, err = rows.filter((r) => r.level === 'error').length;

  useEffect(() => { if (auto && open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [shown, auto, open]);

  const resize = (e: PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = height;
    const mv = (ev: globalThis.PointerEvent) => setHeight(Math.max(120, Math.min(window.innerHeight - 260, h0 + y0 - ev.clientY)));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const copy = () => navigator.clipboard?.writeText(shown.map((r) => `${r.t} ${r.level.toUpperCase()} ${r.src} ${r.msg}`).join('\n')).catch(() => {});

  return (
    <section aria-label="Console" className="console" style={{ height: open ? height : 30 }}>
      {open && <div onPointerDown={resize} role="separator" aria-label="Resize console" style={{ position: 'absolute', top: -3, left: 0, right: 0, height: 6, cursor: 'row-resize', zIndex: 2 }} />}
      <div className="console-bar">
        <button className="btn ib" style={{ height: 26, width: 26 }} onClick={() => setOpen(!open)} aria-label="Toggle console" aria-expanded={open}><IconChevron size={14} rot={open ? 180 : 0} /></button>
        <span className="console-title">Console</span>
        <span className="muted">{rows.length} events</span>
        {warn > 0 && <span style={{ color: 'var(--warn)' }}>{warn} warn</span>}
        {err > 0 && <span style={{ color: 'var(--err)' }}>{err} error</span>}
        <span style={{ flex: 1 }} />
        {open && <>
          <div className="seg" role="group" aria-label="Log level">
            {(['all', 'info', 'warn', 'error'] as const).map((l) => <button key={l} aria-pressed={level === l} onClick={() => setLevel(l)}>{l[0].toUpperCase() + l.slice(1)}</button>)}
          </div>
          <input className="inp" style={{ width: 160 }} placeholder="Filter text…" aria-label="Filter logs" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer', whiteSpace: 'nowrap' }}><input type="checkbox" checked={auto} onChange={() => setAuto(!auto)} />Auto-scroll</label>
          <button className="btn" onClick={copy}>Copy</button>
          <button className="btn" onClick={onClear}>Clear</button>
        </>}
      </div>
      {open && (
        <div ref={listRef} className="log-list">
          {shown.map((r) => (
            <div key={r.id} className="log-row" style={{ color: COLOR[r.level] }}>
              <span className="muted">{r.t}</span><span style={{ textTransform: 'uppercase' }}>{r.level}</span><span className="muted">{r.src}</span>
              <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text)' }}>{r.msg}</span>
            </div>
          ))}
          {shown.length === 0 && <div className="muted" style={{ padding: '6px 12px' }}>{rows.length ? 'No events match the filter.' : 'No events yet. Runtime stdout/stderr appears here.'}</div>}
        </div>
      )}
    </section>
  );
}
