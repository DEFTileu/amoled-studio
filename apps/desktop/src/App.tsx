import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FirmwareImages, RuntimeConfig } from '@contracts/v1';
import { Console } from './components/Console';
import { DevicePreview, type TouchInfo } from './components/DevicePreview';
import { Dialogs, type DialogKind } from './components/Dialogs';
import { Header } from './components/Header';
import { Inspector } from './components/Inspector';
import { Sidebar } from './components/Sidebar';
import { errMsg, saveScreenshot, type RuntimeClient } from './runtime/client';
import { FrameStore } from './runtime/frame';
import { TouchSender } from './runtime/touch';
import { useRuntime } from './runtime/useRuntime';
import type { Mode, SimCfg } from './types';

const Preview3D = lazy(() => import('./components/Preview3D')); // three.js only loads on first 3D use

export default function App({ client }: { client: RuntimeClient }) {
  const store = useMemo(() => new FrameStore(), []);
  const rt = useRuntime(store, client);
  const sender = useMemo(() => new TouchSender((r) => client.touch(r), (m) => rt.log('error', 'touch', m)), [client, rt.log]);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleH, setConsoleH] = useState(220);
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [mode, setModeState] = useState<Mode>('firmware');
  const [sim, setSim] = useState<SimCfg>({ battery: 80, brightness: 100, accelX: 0, timeMs: 0 });
  const [flash, setFlash] = useState<16 | 32>(16);
  const [images, setImages] = useState<FirmwareImages | null>(null);
  const [touch, setTouch] = useState<TouchInfo>({ x: 0, y: 0, down: false, has: false });

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  useEffect(() => { if (rt.defaults) setImages((i) => i ?? rt.defaults); }, [rt.defaults]);

  const active = rt.run === 'starting' || rt.run === 'running';
  const firmwareLive = rt.run === 'running' && rt.status?.kind === 'firmware';
  const noImages = mode === 'firmware' && !images;
  const blockedReason = rt.backendError;

  useEffect(() => { if (!firmwareLive) setTouch((t) => ({ ...t, down: false, has: false })); }, [firmwareLive]);

  const config = (): RuntimeConfig | null =>
    mode === 'simulator' ? { mode, battery_percent: sim.battery, brightness_percent: sim.brightness, accel_x: sim.accelX, time_ms: sim.timeMs }
      : images ? { mode, flash_mb: flash, psram_mb: 8, images } : null;

  const start = () => { const c = config(); if (c) rt.start(c); else setDialog('firmware'); };
  const restart = async () => { if (rt.busy) return; if (rt.status?.state === 'running') await rt.stop(); start(); };
  const setMode = async (m: Mode) => { if (m === mode || rt.busy) return; if (rt.status?.state === 'running') await rt.stop(); setModeState(m); };
  const shot = () => saveScreenshot(client)
    .then((p) => p && rt.log('info', 'studio', `Screenshot saved: ${p}`))
    .catch((e) => rt.log('error', 'studio', `Screenshot failed: ${errMsg(e)}`));

  const restartRef = useRef(restart); restartRef.current = restart;
  const onKey = useCallback((e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'r') { e.preventDefault(); restartRef.current(); } }, []);
  useEffect(() => { window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onKey]);

  return (
    <div className="app">
      <Header board={rt.profile?.id ?? 'Waveshare ESP32-S3-Touch-AMOLED-1.75C'} mode={mode} setMode={setMode} run={rt.run} busy={!!rt.busy} noConfig={!!blockedReason}
        view={view} setView={setView} canShot={firmwareLive && !rt.busy} onStart={start} onStop={rt.stop} onRestart={restart} onShot={shot}
        onSidebar={() => setSidebarOpen((o) => !o)} onInspector={() => setInspectorOpen((o) => !o)} onTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
      <div className="body">
        <Sidebar open={sidebarOpen} mode={mode} setMode={setMode} backend={rt.backendError ? 'down' : rt.profile ? 'ok' : 'pending'}
          onFirmware={() => setDialog('firmware')} onDevice={() => setInspectorOpen(true)} onSettings={() => setDialog('settings')} onContract={() => setDialog('contract')} />
        <main className="main">
          <section className="preview" aria-label="Device preview">
            {view === '2d'
              ? <DevicePreview store={store} sender={sender} run={rt.run} mode={mode} canTouch={firmwareLive && !rt.busy} noConfig={noImages || !!blockedReason} blockedReason={blockedReason}
                  error={rt.error} onStart={start} onRestart={restart} onConsole={() => setConsoleOpen(true)} onTouch={setTouch} />
              : <Suspense fallback={<div className="caption" style={{ top: 12 }}>Loading 3D viewer…</div>}><Preview3D store={store} /></Suspense>}
          </section>
          <Console rows={rt.rows} open={consoleOpen} height={consoleOpen ? consoleH : 30} setOpen={setConsoleOpen} setHeight={setConsoleH} onClear={rt.clearRows} />
        </main>
        {inspectorOpen && <Inspector mode={mode} locked={active} touchLive={firmwareLive} touch={touch} sim={sim} setSim={setSim}
          flash={flash} setFlash={setFlash} flashOptions={rt.profile?.flash_options_mb ?? [16, 32]} images={images} onSelectFirmware={() => setDialog('firmware')} />}
      </div>
      <Dialogs key={dialog ?? 'none'} kind={dialog} close={() => setDialog(null)} theme={theme} setTheme={setTheme} pick={client.canPickFile ? client.pickFile : null} uploads={client.transport === 'browser'}
        images={images} defaults={rt.defaults} applyImages={(i) => { setImages(i); setModeState('firmware'); }} backendError={rt.backendError} />
    </div>
  );
}
