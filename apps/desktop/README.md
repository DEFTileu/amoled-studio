# AMOLED Studio (frontend + Tauri 2 host)

One React + TypeScript frontend (`src/`) for two hosts. UI components depend only on the `RuntimeClient` interface
(`src/runtime/client.ts`); transports are separate adapters:

| Adapter | File | Status |
|---|---|---|
| Tauri IPC | `src/runtime/tauriClient.ts` (the only file importing `@tauri-apps/*`) | working against the 8 `amoled-runtime` commands |
| Browser HTTP/WebSocket | `src/runtime/browserClient.ts` | working against `runtime/HTTP_API.md` (same-origin, launched by `amoled-studio serve --open`) |

Types come from `runtime/contracts/v1.ts` (alias `@contracts`). Nothing in `runtime/` is modified from here.

## Commands

```sh
npm install
npm run typecheck && npm test && npm run build      # frontend
(cd src-tauri && cargo check)                       # Tauri host
npx tauri build --debug --no-bundle                 # debug app: src-tauri/target/debug/amoled-studio
e2e/run.sh [out-dir]                                # self-test inside the real WKWebView (needs the debug build above)
npm run package                                     # release .app (see below)
npm run test:integration                            # browser adapter vs the real launcher/emulator (STUDIO_RUNTIME_E2E=1; needs npm run build first)
```

## Browser mode

`amoled-studio serve --open` serves `dist/` and the API from one loopback origin and opens a URL whose fragment carries a one-use
nonce. The adapter removes the fragment, exchanges it once (`POST /session`) for the bearer token and keeps that in memory and
`sessionStorage` (survives a refresh, cleared when the tab closes; never `localStorage`, a URL or a log). The WebSocket sends the token in
its first message. Frames arrive as PNGs from `/v1/stream` (about every 500 ms) and are converted to the RGB565 frame format the
2D/3D preview already consumes; a touch release also pulls one fresh `/v1/frame` so taps feel immediate.

Firmware selection: Browse opens a file chooser; the bytes are held in the page and uploaded once with `POST /v1/firmware` when you
start (the server accepts four uploads per lifetime, so the `image_id` is reused for the same selection). "Use project build" selects the server's `default`.
Not supported in the browser: typing a path, and the LVGL simulator preview (it is a native SDL window).

## Self-test (`e2e/`)

`src-tauri/src/lib.rs` has a `#[cfg(debug_assertions)]` hook: when `AMOLED_STUDIO_E2E=<script>` and `AMOLED_STUDIO_E2E_OUT=<dir>`
are set, it focuses the window and evaluates the script inside the webview. `e2e/studio-e2e.js` clicks the real buttons, dispatches
pointer events on the real canvas and drives the real runtime. It stubs only the native save dialog (it cannot be dismissed
without Accessibility permission). The hook is compiled out of release builds and is inert without those variables.
Needs a Mac with the firmware images and `esp32sim` built; the simulator steps need `build/amoled-simulator` and Homebrew SDL2.

## Packaging

`npm run package` = `tauri build --config src-tauri/tauri.release.conf.json`. The overlay bundles the firmware emulator and the
default images under `Contents/Resources/studio-root/` (same layout `RuntimeManager` expects). `project_root()` uses that directory
only when the executable is inside `*.app/Contents/MacOS`; `AMOLED_PROJECT_ROOT` overrides everywhere; dev builds use the repo.

Not done / not tested: code signing, notarization, DMG, Intel or universal builds, auto-update. The bundle is unsigned.

## Needed from the backend (Codex-owned, not changed here)

1. **Emulator WebSocket and browser origins.** `esp32sim` answers `403` to `Origin: tauri://localhost` (and any other origin), so a
   webview cannot read frames directly (the CSP no longer allows it either). The host relays them: `src-tauri/src/frames.rs` reads
   `RuntimeManager::connect_frame_stream()` and forwards binary frames over a Tauri channel. The manager is created with
   `RuntimeManager::new_private`, which keeps the viewer token-gated, so `viewer_url` is `null` in the Tauri path. The runtime
   README still does not mention the origin check or `new_private`.
2. **LVGL simulator is not relocatable.** `build/amoled-simulator` links `/opt/homebrew/opt/sdl2-compat/lib/libSDL2-2.0.0.dylib`,
   so it is not bundled; a packaged app reports "file not found" for simulator mode. Static SDL2 or a bundled dylib with `@rpath` is needed.
3. **Browser adapter.** Needs the published HTTP/WS contract (auth, firmware by uploaded `image_id`, `/v1/stream` frame format).
4. Each `send_touch` opens a new WebSocket (already documented); fine at current rates.
