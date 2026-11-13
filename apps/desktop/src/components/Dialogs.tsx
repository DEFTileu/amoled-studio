import { useState, type ReactNode } from 'react';
import type { FirmwareImages } from '@contracts/v1';
import contractText from '@contracts/v1.ts?raw';
import { errMsg } from '../runtime/client';
import { IconClose } from './icons';

export type DialogKind = 'firmware' | 'settings' | 'contract' | null;

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row2" style={{ alignItems: 'center' }}><span style={{ font: '600 22px var(--head)' }}>{title}</span>
          <button className="btn ib" onClick={onClose} aria-label="Close"><IconClose /></button></div>
        {children}
      </div>
    </div>
  );
}

function PathRow({ label, value, onChange, optional, pick, upload, onError }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean; pick: (() => Promise<string | null>) | null; upload: boolean; onError: (m: string) => void }) {
  const browse = async () => { onError(''); try { const f = await pick?.(); if (f) onChange(f); } catch (e) { onError(errMsg(e)); } };
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 8, alignItems: 'center' }}>
      <span>{label}{optional && <span className="muted"> (optional)</span>}</span>
      <input className="inp" style={{ height: 30 }} value={value} placeholder={upload ? 'No file chosen' : '/absolute/path'} readOnly={upload} onChange={(e) => onChange(e.target.value)} />
      <button className="btn" type="button" disabled={!pick} title={pick ? undefined : 'No file picker available; type a path'} onClick={browse}>Browse…</button>
    </label>
  );
}

const KEYS: [keyof FirmwareImages, string, boolean][] = [['bootloader', 'Bootloader', false], ['partition_table', 'Partition table', false], ['app', 'Application', false], ['elf', 'ELF', true]];

export interface DialogsProps {
  kind: DialogKind; close: () => void; theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void;
  pick: (() => Promise<string | null>) | null; /** Browser host: files are uploaded to the local runtime, so paths cannot be typed. */ uploads: boolean; images: FirmwareImages | null; defaults: FirmwareImages | null; applyImages: (i: FirmwareImages) => void; backendError: string | null;
}

export function Dialogs(p: DialogsProps) {
  const [draft, setDraft] = useState<FirmwareImages | null>(p.images ?? p.defaults);
  const [pickError, setPickError] = useState('');
  if (p.kind === 'firmware') {
    const set = (k: keyof FirmwareImages, v: string) => setDraft((d) => ({ ...(d as FirmwareImages), [k]: v === '' && k === 'elf' ? null : v }));
    return (
      <Shell title="Firmware images" onClose={p.close}>
        <div className="muted">{p.uploads
          ? 'Choose the ESP-IDF build outputs the Firmware Emulator loads. They are uploaded to the local runtime when you start (nothing leaves this machine); “Use project build” selects the bundled firmware. The backend checks the ESP image magic and partition table size.'
          : 'Absolute paths to the ESP-IDF build outputs the Firmware Emulator loads. The backend checks the ESP image magic and partition table size when starting.'}</div>
        {draft && KEYS.map(([k, label, opt]) => <PathRow key={k} pick={p.pick} upload={p.uploads} onError={setPickError} label={label} optional={opt} value={draft[k] ?? ''} onChange={(v) => set(k, v)} />)}
        {pickError && <div role="alert" style={{ color: 'var(--err)' }}>{pickError}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" disabled={!p.defaults} onClick={() => setDraft(p.defaults)}>Use project build</button>
          <button className="btn pri" disabled={!draft} onClick={() => { if (draft) { p.applyImages(draft); p.close(); } }}>Use firmware</button>
        </div>
      </Shell>
    );
  }
  if (p.kind === 'settings') return (
    <Shell title="Application settings" onClose={p.close}>
      <div className="row2" style={{ alignItems: 'center' }}><span>Theme</span>
        <div className="seg"><button aria-pressed={p.theme === 'light'} onClick={() => p.setTheme('light')}>Light</button><button aria-pressed={p.theme === 'dark'} onClick={() => p.setTheme('dark')}>Dark</button></div></div>
      <div className="muted">Window layout and runtime settings are kept for this session only.</div>
    </Shell>
  );
  if (p.kind === 'contract') return (
    <Shell title="Runtime API contract v1" onClose={p.close}>
      <div style={{ color: p.backendError ? 'var(--err)' : 'var(--muted)' }}>{p.backendError ? `Backend unavailable: ${p.backendError}` : 'Connected. These are the typed contracts Studio calls; the backend implementation is the source of truth.'}</div>
      <pre>{contractText}</pre>
      <button className="btn" style={{ justifySelf: 'start' }} onClick={() => navigator.clipboard?.writeText(contractText).catch(() => {})}>Copy contract</button>
    </Shell>
  );
  return null;
}
