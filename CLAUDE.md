# RayLink — Android-Mac Clipboard Sync & File Transfer

## Architecture
Three components communicate over local WiFi:
- **Raycast Extension** (`src/`) — TypeScript/React UI layer
- **Node.js Daemon** (`daemon/`) — persistent background service, handles networking
- **Android Companion App** (`android/`) — Kotlin/Jetpack Compose

## Build & Run

### Daemon
```bash
cd daemon && npm install && npm run build && node dist/index.js
```
For development with auto-reload: `npm run dev`

### Raycast Extension
```bash
npm install && npm run dev
```

### Android App
Open `android/` in Android Studio and build.

## Protocol
- Discovery: mDNS `_raylink._tcp` on port 18734
- Communication: JSON messages over WebSocket/TLS
- Message types defined in `daemon/src/protocol.ts` and `android/.../Protocol.kt`
- **Important**: Android sends all body values as strings; daemon must handle both string and native types (use explicit coercion, not type assertions)

## Key Design Decisions
- Local network only (no cloud relay) — privacy-first, sub-ms latency
- Daemon is the WebSocket server; Android is the client
- Clipboard polling on Mac via `pbpaste` (500ms), Accessibility Service on Android
- Files chunked at 64KB for WebSocket, streamed for files >10MB
- Self-signed TLS certificates with certificate pinning after pairing

## Testing
Start daemon, verify with: `curl http://127.0.0.1:19876/status`
