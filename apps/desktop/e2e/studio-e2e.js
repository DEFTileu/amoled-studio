// In-webview self-test for the real Tauri build. Run with e2e/run.sh (debug binary only).
// Drives the actual DOM (button clicks, pointer events on the canvas) against the real IPC + runtime.
// Only the native save dialog is stubbed: it cannot be dismissed without Accessibility permission.
(async () => {
  const T = window.__TAURI_INTERNALS__;
  // An occluded/unfocused WKWebView pauses requestAnimationFrame (correct for a window nobody sees) and would stall FrameStore's
  // coalesced painting; drive it by timer so the test measures the frame pipeline, not window visibility.
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
  const results = [];
  const write = (name, text) => T.invoke('e2e_write', { name, text });
  const flush = () => write('results.json', JSON.stringify(results, null, 1));
  const rec = async (step, ok, detail = '') => { results.push({ step, ok, detail }); await flush(); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, every = 100) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(every); } };
  const $ = (s) => document.querySelector(s);
  const btn = (label) => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent.trim() === label);
  const pill = () => $('.pill')?.textContent.trim();
  const rows = () => [...document.querySelectorAll('.log-row')].map((r) => r.textContent);

  // --- IPC spy at the fetch layer (T.invoke is read-only): records send_touch order/overlap, stubs the native save dialog ---
  const touches = []; const mocks = {}; const seen = new Set(); let seq = 0, inflight = 0, overlap = 0;
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const m = /^(?:ipc:\/\/localhost|https?:\/\/ipc\.localhost)\/([^?]+)/.exec(url);
    if (!m) return realFetch(input, init);
    const cmd = decodeURIComponent(m[1]); seen.add(cmd);
    if (mocks[cmd]) return Promise.resolve(new Response(JSON.stringify(mocks[cmd]()), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }));
    if (cmd !== 'send_touch') return realFetch(input, init);
    const body = init?.body; const req = JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body)).request;
    const r1 = { n: seq++, ...req, err: null }; if (inflight++ > 0) overlap++; touches.push(r1);
    return realFetch(input, init).then(async (res) => { if (res.headers.get('Tauri-Response') !== 'ok') r1.err = await res.clone().text(); return res; }, (e) => { r1.err = String(e); throw e; }).finally(() => { inflight--; });
  };
  const orig = (cmd, args) => T.invoke(cmd, args);
  const status = () => orig('get_runtime_status');

  // --- canvas helpers ---
  const canvas = () => $('canvas[aria-label^="Device display"]');
  const pixels = () => canvas().getContext('2d').getImageData(0, 0, 466, 466).data;
  const hash = (d) => { let h = 2166136261; for (let i = 0; i < d.length; i += 4) h = Math.imul(h ^ (d[i] | d[i + 1] << 8 | d[i + 2] << 16), 16777619); return h >>> 0; };
  const stats = () => { const d = pixels(); let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] | d[i + 1] | d[i + 2]) lit++; const px = (x, y) => [...d.slice((y * 466 + x) * 4, (y * 466 + x) * 4 + 3)]; return { lit, corner: px(2, 2), center: px(233, 233), hash: hash(d) }; };
  const ptr = (type, x, y) => {
    const r = canvas().getBoundingClientRect();
    canvas().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + (x + 0.5) / 466 * r.width, clientY: r.top + (y + 0.5) / 466 * r.height }));
  };
  const errors = []; window.addEventListener('error', (e) => errors.push(e.message)); window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + e.reason));

  try {
    // 1. shell + backend link
    await rec('webview has Tauri IPC', !!T, 'transport=tauri');
    const profile = await orig('get_board_profile');
    await rec('get_board_profile via IPC', profile.width === 466 && profile.shape === 'round', JSON.stringify(profile));
    await rec('header shows backend connected (sidebar dot)', !!$('nav[aria-label="Sidebar"]'), pill());
    const startBtn = btn('Start');
    await rec('Start enabled with default images', !!startBtn && !startBtn.disabled, startBtn ? `disabled=${startBtn.disabled}` : 'no Start button');
    await rec('theme toggle flips data-theme', await (async () => { const a = document.documentElement.dataset.theme; btn('Toggle theme').click(); await sleep(150); const b = document.documentElement.dataset.theme; btn('Toggle theme').click(); await sleep(150); return a !== b && document.documentElement.dataset.theme === a; })(), '');

    // 2. Start (firmware mode is the default)
    if (btn('Firmware Emulator').getAttribute('aria-pressed') !== 'true') btn('Firmware Emulator').click();
    const t0 = Date.now(); btn('Start').click();
    const sawStarting = await until(() => pill() === 'Starting…', 3000, 30);
    const running = await until(() => pill() === 'Running', 120000, 200);
    await rec('Start -> Starting… -> Running', !!running, `sawStarting=${!!sawStarting} elapsed=${Date.now() - t0}ms pill=${pill()}`);
    const st1 = await status();
    await rec('status via IPC: running firmware with pid (viewer is private: viewer_url null)', st1.state === 'running' && st1.kind === 'firmware' && !!st1.pid && st1.viewer_url === null, JSON.stringify(st1));

    // 3a. page visibility: a backgrounded WKWebView pauses requestAnimationFrame, so the canvas cannot repaint
    const vis = () => `visibility=${document.visibilityState} focus=${document.hasFocus()}`;

    // 3. firmware frames
    const tl = []; const tStart = Date.now(); const lit = await until(() => { const l = stats().lit; if (tl.length < 40) tl.push(`${Date.now() - tStart}ms:${l}`); return l > 5000; }, 15000, 250);
    await write('frame-timeline.txt', tl.join(' '));
    const s1 = stats();
    await rec('firmware frames painted on the 2D canvas', !!lit, `${vis()} ${JSON.stringify(s1)}`);
    await rec('round display: corner black, centre lit', s1.corner.every((v) => v === 0) && s1.center.some((v) => v > 0), `corner=${s1.corner} center=${s1.center}`);
    await write('frame-live.png.txt', canvas().toDataURL('image/png'));

    // let the boot animation settle so the canvas and the backend capture are the same frame
    await until(async () => { const h = stats().hash; await sleep(1000); return h === stats().hash; }, 30000, 0);

    // 4. backend capture vs live canvas (cross-checks WS decode against the runtime's own PNG)
    const snap = await orig('capture_framebuffer');
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + snap.data_base64; });
    const oc = document.createElement('canvas'); oc.width = oc.height = 466; const octx = oc.getContext('2d'); octx.drawImage(img, 0, 0);
    const a = octx.getImageData(0, 0, 466, 466).data, b = pixels(); let sum = 0, max = 0;
    for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k] - b[i + k]); sum += d; if (d > max) max = d; }
    await rec('capture_framebuffer PNG is 466x466', snap.width === 466 && snap.height === 466 && img.naturalWidth === 466, `${snap.width}x${snap.height}`);
    await rec('live canvas matches backend capture', sum / (466 * 466 * 3) < 3, `meanAbsDiff=${(sum / (466 * 466 * 3)).toFixed(3)} maxDiff=${max}`);
    await write('capture-backend.png.txt', 'data:image/png;base64,' + snap.data_base64);

    // 5. logs in the UI
    if ($('[aria-label="Toggle console"]')?.getAttribute('aria-expanded') === 'false') $('[aria-label="Toggle console"]').click();
    await sleep(700);
    const r1 = rows();
    await rec('console shows real runtime output', r1.length > 0, `${r1.length} rows; last: ${r1.at(-1)}`);
    await rec('readiness marker AMOLED_FIRMWARE_LVGL_READY in console', r1.some((r) => r.includes('AMOLED_FIRMWARE_LVGL_READY')), '');
    await write('console.txt', r1.join('\n'));

    // 6. touch: tap
    touches.length = 0; overlap = 0; const before = stats().hash;
    ptr('pointerdown', 233, 233); await sleep(60); ptr('pointerup', 233, 233); await sleep(700);
    let seqs = touches.map((t) => t.action);
    await rec('tap -> press, release sent via send_touch', seqs[0] === 'press' && seqs.at(-1) === 'release' && !touches.some((t) => t.err), `${seqs.join(',')} errs=${touches.filter((t) => t.err).map((t) => t.err)} errors=${errors.slice(-2)}`);
    await rec('tap coordinates are 233,233', touches[0]?.x === 233 && touches[0]?.y === 233, JSON.stringify(touches[0]));
    await rec('(info) frame changed after tap', true, String(stats().hash !== before));

    // 6b. tap the firmware's own "Switch screen" button (centre ~233,263): the screen must really change, twice
    const tap = async (x, y) => { ptr('pointerdown', x, y); await sleep(80); ptr('pointerup', x, y); };
    const cap = async () => (await orig('capture_framebuffer')).data_base64;
    const c0 = await cap(); await tap(233, 263);
    const c1 = await until(async () => (await cap()) !== c0, 4000, 150); const c1v = await cap();
    await write('frame-after-button-tap.png.txt', canvas().toDataURL('image/png'));
    await tap(233, 263); const c2 = await until(async () => (await cap()) !== c1v, 4000, 150);
    await rec('tapping the on-screen button changes the firmware screen (twice, via backend capture)', !!c1 && !!c2, `first=${!!c1} second=${!!c2} ${vis()}`);

    // 7. swipe: right-to-left with many moves
    touches.length = 0; overlap = 0; const beforeSwipe = stats().hash;
    ptr('pointerdown', 380, 233);
    for (let i = 1; i <= 24; i++) { await sleep(16); ptr('pointermove', 380 - i * 12, 233); }
    ptr('pointerup', 92, 233); await sleep(1200);
    seqs = touches.map((t) => t.action);
    const moves = seqs.filter((a2) => a2 === 'move').length;
    await rec('swipe -> press, N moves, release in order', seqs[0] === 'press' && seqs.at(-1) === 'release' && moves >= 1 && seqs.slice(1, -1).every((a2) => a2 === 'move'), `press=1 moves=${moves} (24 pointermoves, coalesced) release=${seqs.at(-1) === 'release'}`);
    await rec('swipe send_touch calls never overlapped, no errors', overlap === 0 && !touches.some((t) => t.err), `overlap=${overlap} errs=${touches.filter((t) => t.err).map((t) => t.err)}`);
    await rec('swipe release at x=92', touches.at(-1)?.x === 92, JSON.stringify(touches.at(-1)));
    await rec('(info) frame changed after swipe', true, String(stats().hash !== beforeSwipe));
    await write('frame-after-swipe.png.txt', canvas().toDataURL('image/png'));
    // press outside the circle must be ignored client-side
    touches.length = 0; ptr('pointerdown', 4, 4); ptr('pointerup', 4, 4); await sleep(200);
    await rec('press outside the round glass sends nothing', touches.length === 0, `sent=${touches.length}`);

    // 8. screenshot through the real button; only the native dialog is stubbed
    const home = window.__E2E__.home;
    let dlg = 0; mocks['plugin:dialog|save'] = () => { dlg++; return `${home}/Pictures/amoled-e2e-shot.png`; };
    const n0 = rows().length; btn('Screenshot').click();
    const shotRow = await until(() => rows().find((r) => /Screenshot (saved|failed)/.test(r)), 8000, 100);
    await rec('Screenshot button -> save into Pictures (fs scope)', !!shotRow && /saved/.test(shotRow) && dlg === 1, `dialogStubHits=${dlg} ${shotRow}`);
    mocks['plugin:dialog|save'] = () => '/tmp/amoled-e2e-denied.png';
    btn('Screenshot').click();
    const denied = await until(() => rows().find((r) => /Screenshot failed/.test(r)), 8000, 100);
    await rec('Screenshot outside scope is refused and reported in console', !!denied, String(denied));
    delete mocks['plugin:dialog|save'];
    void n0;

    // 9. restart
    const pid1 = st1.pid; btn('Restart').click();
    const left = await until(() => pill() !== 'Running', 5000, 30);
    const again = await until(() => pill() === 'Running', 120000, 200);
    const st2 = await status();
    await rec('Restart -> new process, Running again', !!again && st2.pid && st2.pid !== pid1, `leftRunning=${!!left} pid ${pid1} -> ${st2.pid}`);
    const lit2 = await until(() => stats().lit > 5000, 15000, 200);
    await rec('frames resume after restart', !!lit2, `${vis()} ${JSON.stringify(stats())}`);

    // 10. stop
    btn('Stop').click();
    const stopped = await until(() => pill() === 'Stopped', 20000, 100);
    const st3 = await status();
    await rec('Stop -> Stopped, status stopped, pid cleared', !!stopped && st3.state === 'stopped' && !st3.pid, JSON.stringify(st3));
    await rec('stopped overlay offers Start again', !!$('button[aria-label="Start runtime"]'), '');
    await rec('Screenshot disabled when stopped', btn('Screenshot').disabled, '');

    // 11. simulator mode (opens its own SDL window)
    btn('LVGL Simulator').click(); await sleep(200);
    await rec('simulator: Screenshot disabled (no framebuffer API)', btn('Screenshot').disabled, '');
    btn('Start').click();
    const simRun = await until(() => pill() === 'Running' || pill() === 'Error', 40000, 200);
    const st4 = await status();
    await rec('simulator Start -> Running', pill() === 'Running' && st4.kind === 'simulator', `pill=${pill()} status=${JSON.stringify(st4)}`);
    await rec('simulator overlay explains SDL window', /Simulator running/.test($('.overlay')?.textContent ?? ''), $('.overlay')?.textContent ?? '');
    void simRun;
    if (pill() !== 'Stopped') { btn('Stop')?.click(); await until(() => pill() === 'Stopped', 20000, 100); }
    await rec('simulator Stop -> Stopped', pill() === 'Stopped', pill());

    await rec('no uncaught page errors', errors.length === 0, errors.join(' | '));
  } catch (e) {
    await rec('HARNESS EXCEPTION', false, String(e && e.stack || e));
  } finally {
    try { const s = await status(); if (s.state !== 'stopped') await orig('stop_runtime'); } catch { /* ignore */ }
    await write('ipc-commands-seen.txt', [...seen].join('\n'));
    await write('done', String(Date.now()));
    await T.invoke('e2e_exit');
  }
})();
