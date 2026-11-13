import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardProfile, FirmwareImages, LogEntry, RuntimeConfig, RuntimeStatus } from '@contracts/v1';
import { errMsg, type RuntimeClient } from './client';
import type { FrameStore } from './frame';
import { mergeBackend, parseLine, stamp, type Level, type Row } from './logs';

/** `starting` covers both the start command and firmware boot: the backend's `running` only means the viewer port answered. */
export type Run = 'stopped' | 'starting' | 'running' | 'error';
const READY = 'AMOLED_FIRMWARE_LVGL_READY';
const POLL_MS = 500;

export function useRuntime(store: FrameStore, api: RuntimeClient) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [profile, setProfile] = useState<BoardProfile | null>(null);
  const [defaults, setDefaults] = useState<FirmwareImages | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'starting' | 'stopping' | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);
  const known = useRef<LogEntry[]>([]);
  const seq = useRef(0);
  const polling = useRef(false);

  const log = useCallback((level: Level, src: string, msg: string) =>
    setRows((r) => [...r, { id: ++seq.current, t: stamp(), level, src, msg }].slice(-2000)), []);

  const syncLogs = useCallback(async () => {
    const next = await api.logs();
    const fresh = mergeBackend(known.current, next);
    known.current = next;
    if (!fresh.length) return;
    const t = stamp();
    setRows((r) => [...r, ...fresh.map((e) => ({ id: ++seq.current, t, src: e.stream, ...parseLine(e) }))].slice(-2000));
    if (fresh.some((e) => e.message.includes(READY))) setReady(true);
  }, [api]);

  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try { setStatus(await api.status()); await syncLogs(); } catch (e) { setBackendError(errMsg(e)); } finally { polling.current = false; }
  }, [api, syncLogs]);

  // Initial handshake with the backend; also adopts a runtime that outlived a webview reload.
  useEffect(() => {
    Promise.all([api.boardProfile(), api.defaultImages(), api.status()])
      .then(([p, d, s]) => { setProfile(p); setDefaults(d); setStatus(s); log('info', 'studio', `Runtime API v${p.api_version} connected · ${p.id}`); return syncLogs(); })
      .catch((e) => { setBackendError(errMsg(e)); log('error', 'studio', `Runtime backend unavailable: ${errMsg(e)}`); });
  }, [api, log, syncLogs]);

  const active = status?.state === 'running' || busy !== null;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [active, refresh]);

  // A crash is only observed by polling; the tick that sees it has already pulled the final logs.
  useEffect(() => {
    store.onContent = () => setReady(true);
    if (!status) return;
    return api.frames(status, (f) => store.push(f));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect only when the stream's identity changes, not on every status poll
  }, [api, store, status?.state, status?.kind, status?.viewer_url]);

  const start = useCallback(async (config: RuntimeConfig) => {
    setStartError(null); setReady(false); known.current = []; setRows([]); store.clear(); setBusy('starting');
    log('info', 'runtime', `start_runtime(${config.mode}${config.mode === 'firmware' ? `, flash ${config.flash_mb} MB` : ''})`);
    try { setStatus(await api.start(config)); } catch (e) {
      setStartError(errMsg(e)); log('error', 'runtime', errMsg(e));
      api.status().then(setStatus).catch(() => {});
    } finally { setBusy(null); }
    syncLogs().catch(() => {});
  }, [api, log, store, syncLogs]);

  const stop = useCallback(async () => {
    setBusy('stopping'); setStartError(null);
    try { setStatus(await api.stop()); log('info', 'runtime', 'stop_runtime()'); await syncLogs(); } catch (e) { log('error', 'runtime', errMsg(e)); } finally { setBusy(null); }
    setReady(false); store.clear();
  }, [api, log, store, syncLogs]);

  const run: Run = busy === 'starting' ? 'starting'
    : startError || status?.state === 'failed' ? 'error'
    : status?.state === 'running' ? (status.kind === 'firmware' && !ready ? 'starting' : 'running')
    : 'stopped';

  return {
    status, profile, defaults, backendError, busy, run, rows, log,
    error: startError ?? status?.error ?? 'Runtime stopped unexpectedly.',
    clearRows: () => setRows([]),
    start, stop,
  };
}
