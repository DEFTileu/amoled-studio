# Frontend integration handoff

The existing React components and styling were left unchanged. `apps/desktop/src/runtime/browserClient.ts` now implements the existing `RuntimeClient` interface using the same-origin v1 HTTP/WebSocket API. The launcher opens a one-use bootstrap fragment, which the adapter removes and exchanges for a session token; do not put the token in a URL or persistent storage. The Tauri adapter continues to use IPC and the Rust frame relay. Desktop firmware frames use a private emulator transport and `viewer_url` is therefore null; use runtime state and kind to subscribe, not the viewer URL.

Browser firmware selection supports the bundled image and user-selected bootloader, partition table, application and optional ELF files. The browser adapter uploads the selected bundle through the HTTP API and references the returned opaque image ID; it does not grant the server arbitrary filesystem access. The simulator remains a native SDL window. See [launch instructions](launch.md) and [HTTP API v1](../runtime/HTTP_API.md).

For desktop distribution, `tools/package-macos.sh` and `tauri.complete.conf.json` stage the compiled engines, SDL libraries, ROM, firmware, and third-party notices. Production builds embed the frontend and run without Vite. The current bundle is ad-hoc signed for local testing and is not notarized.
