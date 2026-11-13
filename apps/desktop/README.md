# Desktop and browser frontend

AMOLED Studio uses one React/TypeScript frontend with two runtime adapters: Tauri IPC for the desktop shell and the local HTTP/WebSocket API for a browser. UI components use the shared `RuntimeClient` interface. Runtime wire types live in `runtime/contracts/`.

For setup and the complete build sequence, start with the [project quick start](../../README.md#quick-start).

## Development commands

Run from `apps/desktop` after installing dependencies:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:integration  # requires the built launcher, firmware, ROM and esp32sim
```

The frontend build is served by `amoled-studio serve --open`. It receives a one-use bootstrap nonce in the URL fragment, exchanges it for a local session token and stores that token in session storage. Browser firmware selection uploads image bundles to the backend and uses opaque image IDs. See [API v1](../../runtime/HTTP_API.md) and the [launch guide](../../docs/launch.md).

## Tauri desktop

```sh
npx tauri build --debug --no-bundle
e2e/run.sh  # real WKWebView self-test; requires built runtime assets
```

The debug self-test hook runs only when its explicit environment variables are set and is not compiled into release builds. Firmware frames are relayed by the Rust host from the private emulator transport. The SDL simulator opens its own window.

For a complete macOS app, run `./tools/package-macos.sh` from the repository root. The app is ad-hoc signed for local testing, not notarized. `npm run package` uses a narrower Tauri overlay and is not the complete SDL-enabled package. Intel/universal builds and clean-machine distribution have not been verified.
