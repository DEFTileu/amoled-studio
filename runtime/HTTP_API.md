# AMOLED Studio local API v1

`amoled-api` is a standalone Rust HTTP/WebSocket service around the same `RuntimeManager` used by the optional Tauri adapter. It binds **only** IPv4 loopback (`127.0.0.1`) and defaults to an OS-allocated port. The service has no frontend and no HTTP endpoint for launching arbitrary programs or reading or writing arbitrary paths.

## Start and connect

From the project root, after building the simulator, firmware, and the patched esp32sim as described in [the firmware guide](../docs/firmware-emulator.md):

```sh
cargo run --locked --manifest-path runtime/Cargo.toml --bin amoled-api -- \
  --project "$PWD" --allow-origin http://localhost:5173
```

Repeat `--allow-origin` for each **exact** trusted browser origin, e.g. `http://localhost:5173` or `tauri://localhost`. No browser origin is allowed by default. `--port 0` (the default) requests an available port; `--port 12345` requests a specific loopback port. The process prints one JSON object containing `address`, `api_version`, and `token_file`, but never prints the token. The token is 32 random bytes encoded as 64 lowercase hex characters, stored in a private temporary directory with a mode-0600 token file on Unix. The service removes it on normal SIGINT/SIGTERM shutdown. Deliver that token to an authorized client out of band; do not put it in a URL, commit it, or log it. Do not expose the token file to untrusted web content.

The standalone `amoled-api` does not offer a browser pairing endpoint. The optional `amoled-studio serve` launcher serves the production frontend and enables a separate one-use browser bootstrap; see [launch instructions](../docs/launch.md). A desktop host may create and pass its own strong token through the Rust `ApiConfig` API. `ApiConfig::new` accepts a 64-character lowercase hex token; callers must generate it with a cryptographic random source, for example `generate_token()`.

All ordinary requests require `Authorization: Bearer <token>`. CORS returns the exact allowed Origin, never `*` or `Access-Control-Allow-Credentials`. OPTIONS preflights require an allowed Origin. Requests with unknown Origins or ambiguous Host, Origin, or Authorization headers are denied; Host must name this loopback endpoint. Clients without an Origin, such as curl, still require the token.

API-managed firmware runs with esp32sim outbound networking disabled (`--net none`). The service uses a **separate secret** to protect its internal esp32sim listener, and does not expose `viewer_url` in API-managed firmware status. On startup it checks that the emulator rejects an unauthenticated request and accepts its private token; an old, unpatched emulator fails closed. Run `tools/setup-esp32sim.sh` after updating this project. The desktop shell uses the same private transport and relays frames internally. Other hosts that construct the legacy `RuntimeManager::new`, and separately launched esp32sim viewers, retain their previous unprotected transport behavior.

Example, after setting `ADDRESS` to the reported address and `TOKEN_FILE` to the reported file path:

```sh
TOKEN="$(cat "$TOKEN_FILE")"
curl -H "Authorization: Bearer $TOKEN" "$ADDRESS/v1/board"
curl -H "Authorization: Bearer $TOKEN" "$ADDRESS/v1/status"
```

## HTTP routes

All JSON responses include `api_version: 1`. Error responses are `{ "api_version": 1, "error": "..." }`; HTTP 400 indicates a rejected operation or invalid upload, 401 authentication failure, 403 Origin/Host rejection, 404 unknown image or route, and 422 malformed JSON. Request bodies are capped at 36 MiB.

| Method and path | Request | Response |
| --- | --- | --- |
| GET `/v1/board` | — | `{api_version, board}` |
| GET `/v1/status` | — | `{api_version, status}` |
| GET `/v1/config` | — | `{api_version, config}`; last successful start request, or null |
| GET `/v1/logs` | — | `{api_version, logs}`; bounded supervisor log buffer |
| POST `/v1/runtime/start` | tagged configuration below | `{api_version, status}` |
| POST `/v1/runtime/stop` | empty | `{api_version, status}` |
| POST `/v1/firmware` | base64 image bundle below | 201 `{api_version, image_id}` |
| GET `/v1/frame` | — | `{api_version, frame}` with 466 × 466 `png_base64` |
| POST `/v1/touch` | `{action,x,y}` | `{api_version,ok:true}` |
| GET `/v1/stream` | WebSocket upgrade | authenticated event stream below |

Start requests use one of:

```json
{"mode":"simulator","battery_percent":70,"brightness_percent":60,"accel_x":0.0,"time_ms":0}
```

```json
{"mode":"firmware","flash_mb":16,"psram_mb":8,"image_id":"default"}
```

`image_id: "default"` selects the server's built-in 1.75C firmware artifact paths under its trusted project root. No path is supplied by the client. For another image, upload JSON `{ "bootloader_base64": "...", "partition_table_base64": "...", "app_base64": "...", "elf_base64": null }` and use the opaque returned ID. Each decoded image is capped at 8 MiB, each server accepts at most four uploads, and the total request cap applies. Only basic magic/length validation is performed; this does not establish that an image is safe, complete or compatible. Uploads are stored under a server-owned private temporary directory and removed on clean shutdown. IDs are valid for that server lifetime only. The server does not flash hardware.

Only one runtime can run at a time. Configuration is supplied at start; changing it or the firmware requires stopping and starting. `/v1/config` retains the last successfully started configuration after stop or crash and does not contain local filesystem paths. The simulator opens its existing SDL window; snapshot and input routes currently operate only in firmware mode. `running` means the child and its viewer port are up, not that firmware has finished initialization. The framebuffer may initially be black; firmware logs identify diagnostic-app readiness.

## WebSocket `/v1/stream`

Connect to `ws://127.0.0.1:<port>/v1/stream` from an allowed Origin. The server sends **no protected data before authentication**. Within three seconds send `{ "type":"auth", "token":"<token>" }`; it replies `{ "type":"authenticated", "api_version":1 }` or closes. Tokens are not accepted in query strings. Unauthenticated and authenticated connections share a limit of eight; messages are limited to 4096 bytes. A slow client is disconnected on send timeout.

After authentication, send `{ "type":"subscribe", "status":true, "logs":true, "frames":true }` to select events. Missing flags default to false. Optional `frame_rate` sets the polling rate from 1 to 30 Hz; invalid values receive an error. Raw RGB565 frames are compared before PNG encoding, and sends have a bounded timeout. Status, bounded logs and changed PNG frames are polled at 10 Hz by default and emitted as `{type:"status",status}`, `{type:"logs",logs}`, and `{type:"frame",frame}`. No frame event is sent until a firmware frame can be obtained. Send `{ "type":"touch", "request":{"action":"press", "x":234, "y":264} }` and await `{type:"touch_result",ok:true}`; `move` and `release` follow the same schema. Order and await input, and release after pressing. If a WebSocket client disconnects while it owns a press, the server attempts a release. Coordinates are display-local 0–465 and outside-circle presses are rejected. Do not mix input sources for the same gesture.

The stream is a polling-based foundation, not a high-frame-rate transport; frame snapshots are PNG/base64. `RuntimeStatus`, `FrameSnapshot` and the underlying RGB565 layout are documented in [runtime/README.md](README.md). No actual hardware accuracy is claimed.

The supervisor orders touch requests and waits for an emulator WebSocket ping/pong barrier after each input message. A successful response confirms that the emulator transport queued the input, not that guest firmware has processed it. The experimental CST9217 model schedules subsequent touch interrupts after a report is read. Its report queue is limited to 64 entries and currently discards the oldest report on overflow; clients should avoid submitting input indefinitely faster than the guest consumes it. This limit is not hardware-validated.

## Lifecycle and verification

SIGINT/SIGTERM or `ApiServer::shutdown` closes WebSockets, cancels in-progress HTTP body reads, stops and reaps the supervised child, and removes temporary uploads and the token file. Ordinary HTTP operations have a 20-second deadline. An uncatchable process kill cannot run cleanup. The process supervisor observes crashes when polled, and only its direct child is supervised. A short port selection/bind race remains for esp32sim's internal listener. Local loopback authentication and Origin checks defend the exposed API; they are not a sandbox against another process with the same OS-user privileges and access to its files or environment.

```sh
STUDIO_RUNTIME_E2E=1 cargo test --locked --manifest-path runtime/Cargo.toml
cargo check --locked --manifest-path runtime/Cargo.toml --features tauri-commands --tests
ctest --test-dir build --output-on-failure
```

The end-to-end tests need the built emulator and ESP-IDF firmware. Wire types live in [contracts/http-v1.ts](contracts/http-v1.ts). No physical board is needed.
