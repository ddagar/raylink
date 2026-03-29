# RayLink - Android Link for Raycast

**Clipboard sync and file transfer between your Mac and Android phone, right from Raycast.**

RayLink is a Raycast extension that brings Phone Link-style functionality to macOS. It provides bidirectional clipboard sync and file transfer over your local WiFi network — no cloud, no account, no subscription. Your data never leaves your network.

## Features

### Clipboard Sync
- **Automatic bidirectional sync** — copy on your Mac, paste on your phone (and vice versa)
- **Mac → Phone**: Detected automatically every 500ms via clipboard polling
- **Phone → Mac**: Detected via Android Accessibility Service
- **Echo suppression** — prevents clipboard ping-pong between devices
- **Clipboard history** — browse all synced clipboard entries with timestamps and source device
- **Sensitive content filtering** — skips clipboard entries marked as sensitive on Android 13+

### File Transfer
- **Mac → Phone**: Select files in Finder, run "Send File to Phone" command
- **Phone → Mac**: Use Android's share sheet, select RayLink
- **Large file support** — streaming transfer for files >10MB (64KB chunks)
- **Progress tracking** — animated toast shows transfer progress with completion status
- **Auto-accept** — incoming file transfers are accepted automatically

### Device Management
- **Zero-config discovery** — devices find each other via mDNS on your local network
- **Secure pairing** — 6-digit verification code derived from TLS certificate fingerprints
- **Auto-reconnect** — reconnects automatically with exponential backoff when connection drops
- **Menu bar status** — persistent menu bar icon shows connection status, quick actions, and recent activity

## Architecture

```
┌──────────────────────┐      Local WiFi (TLS/WSS)      ┌───────────────────────┐
│   macOS               │                                 │   Android              │
│                       │    mDNS (_raylink._tcp)         │                        │
│  ┌─────────────────┐  │◄───────────────────────────────►│  ┌──────────────────┐  │
│  │ Raycast         │  │                                 │  │ RayLink App      │  │
│  │ Extension       │  │    WSS (port 18734)             │  │ (Kotlin/Compose) │  │
│  │ (6 commands)    │  │◄───────────────────────────────►│  │                  │  │
│  └───────┬─────────┘  │                                 │  │ • Accessibility  │  │
│          │ localhost   │                                 │  │   Service        │  │
│  ┌───────▼─────────┐  │                                 │  │ • Share Receiver │  │
│  │ Helper Daemon   │  │                                 │  │ • Foreground Svc │  │
│  │ (Node.js)       │  │                                 │  └──────────────────┘  │
│  └─────────────────┘  │                                 │                        │
└──────────────────────┘                                 └───────────────────────┘
```

Three components:

| Component | Tech | Purpose |
|-----------|------|---------|
| **Raycast Extension** | TypeScript, React | UI — 6 commands + menu bar |
| **Helper Daemon** | Node.js, TypeScript | Persistent background service — TLS WebSocket server, mDNS, clipboard monitor |
| **Android App** | Kotlin, Jetpack Compose | Companion app — Accessibility Service, foreground service, share receiver |

## Requirements

- **Mac**: macOS 12+, [Raycast](https://raycast.com), Node.js 18+
- **Android**: Android 10+ (API 29), Samsung Galaxy Z Fold 5 or any Android device
- **Network**: Both devices on the same WiFi network

## Installation

### 1. Clone and install dependencies

```bash
git clone https://github.com/yourusername/raycast-android.git
cd raycast-android
npm install
cd daemon && npm install && cd ..
```

### 2. Build and start the daemon

```bash
cd daemon
npm run build
node dist/index.js
```

You should see:
```
[daemon] RayLink daemon started
[daemon] Device: Your-Mac (abcd1234...)
[daemon] Local IP: 192.168.1.x
[daemon] WebSocket: wss://0.0.0.0:18734
[daemon] API: http://127.0.0.1:19876
[daemon] mDNS: _raylink._tcp
```

**Optional**: Install as a Launch Agent for auto-start on login:
```bash
# The daemon includes a LaunchAgent plist template
# See daemon/com.raycast-android.daemon.plist
```

### 3. Install the Raycast extension

```bash
# From the project root
npm run dev
```

This opens the extension in Raycast development mode. You'll see "Android Link" commands available.

### 4. Build and install the Android app

**Option A: Android Studio**
1. Open the `android/` directory in Android Studio
2. Connect your phone via USB (enable USB debugging)
3. Click Run

**Option B: Command line**
```bash
cd android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew assembleDebug

# Install on connected device
$ANDROID_HOME/platform-tools/adb install app/build/outputs/apk/debug/app-debug.apk
```

### 5. Connect your devices

1. Open RayLink on your Android phone
2. Enable the **Accessibility Service** (tap the button, it opens Settings)
3. Tap **Start Connection**
4. Your Mac will appear automatically (same WiFi required)
5. In Raycast, open **Devices** — you'll see a pairing request
6. Verify the **6-digit code** matches on both devices
7. Accept the pairing

Done! Clipboard now syncs automatically.

## Usage

### Raycast Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| **Devices** | — | View paired devices, accept pairing requests |
| **Send Clipboard to Phone** | — | Push Mac clipboard to your phone |
| **Pull Clipboard from Phone** | — | Request phone's clipboard |
| **Send File to Phone** | — | Send Finder-selected files to phone |
| **Clipboard History** | — | Browse synced clipboard entries |
| **Android Link Status** | Menu bar | Connection status, quick actions, recent activity |

### Sending Files

**Mac → Phone:**
1. Select one or more files in Finder
2. Open Raycast → "Send File to Phone"
3. Transfer progress shows in a toast notification

**Phone → Mac:**
1. Open any file or select content
2. Tap Share → select "RayLink"
3. File is saved to `~/Downloads` (configurable)

### Preferences

| Setting | Default | Description |
|---------|---------|-------------|
| Download Directory | `~/Downloads` | Where received files are saved |
| Auto Sync Clipboard | Enabled | Automatically sync clipboard in background |
| Show Notifications | Enabled | Show HUD when clipboard syncs |

## Protocol

RayLink uses a custom JSON-over-WebSocket protocol with TLS encryption:

- **Discovery**: mDNS service type `_raylink._tcp` on port 18734
- **Transport**: WebSocket over TLS 1.3 with self-signed certificates
- **Pairing**: Certificate exchange + SHA-256 derived 6-digit verification code
- **Clipboard**: `clipboard.update` / `clipboard.connect` messages (text content)
- **Files**: `file.offer` → `file.accept` → `file.chunk` (64KB base64 chunks)
- **Keepalive**: `ping` / `pong` every 30 seconds

## Security

- **TLS encryption** on all communication (self-signed RSA 2048-bit certificates)
- **Certificate pinning** after pairing — only trusted devices can connect
- **Local network only** — no data leaves your WiFi network
- **No cloud relay** — direct device-to-device communication
- **Sensitive content** — clipboard entries marked `IS_SENSITIVE` on Android 13+ are skipped
- **Private network check** — daemon operates only on private IP ranges

## Project Structure

```
raycast-android/
├── package.json                    # Raycast extension manifest
├── src/                            # Raycast Extension (TypeScript/React)
│   ├── devices.tsx                 # Device management + setup wizard
│   ├── send-clipboard.ts           # Send clipboard command
│   ├── pull-clipboard.ts           # Pull clipboard command
│   ├── send-file.ts                # Send file command with progress
│   ├── clipboard-history.tsx        # Clipboard history list
│   ├── status.tsx                   # Menu bar status + auto-sync
│   └── lib/
│       ├── daemon-client.ts         # HTTP client for daemon API
│       ├── daemon-manager.ts        # Daemon lifecycle (start/stop)
│       ├── preferences.ts           # Extension preferences
│       └── types.ts                 # Shared TypeScript types
├── daemon/                          # Node.js Helper Daemon
│   ├── src/
│   │   ├── index.ts                 # Entry point
│   │   ├── server.ts                # Local HTTP API (port 19876)
│   │   ├── websocket.ts             # TLS WebSocket server (port 18734)
│   │   ├── discovery.ts             # mDNS advertisement
│   │   ├── pairing.ts               # Pairing flow + verification codes
│   │   ├── certificate.ts           # TLS cert generation
│   │   ├── clipboard.ts             # macOS clipboard monitor
│   │   ├── file-transfer.ts         # Chunked file send/receive
│   │   ├── device-store.ts          # Paired device persistence
│   │   └── protocol.ts              # Message types + serialization
│   └── com.raycast-android.daemon.plist  # LaunchAgent template
└── android/                         # Android Companion App (Kotlin)
    └── app/src/main/java/com/raylink/
        ├── MainActivity.kt           # Main UI (Jetpack Compose)
        ├── RayLinkApp.kt             # Application class
        ├── network/
        │   ├── Protocol.kt           # Message types + JSON serialization
        │   ├── WebSocketClient.kt     # OkHttp WSS client + auto-reconnect
        │   ├── MdnsDiscovery.kt       # NSD service discovery
        │   └── CertificateManager.kt  # TLS + device trust
        ├── service/
        │   ├── ConnectionService.kt           # Foreground service
        │   └── ClipboardAccessibilityService.kt # Clipboard monitor
        └── receiver/
            ├── ShareReceiverActivity.kt  # Android share intent handler
            └── BootReceiver.kt           # Auto-start on boot
```

## Development

### Daemon development (with auto-reload)
```bash
cd daemon && npm run dev
```

### Extension development
```bash
npm run dev
```

### Android development
Open `android/` in Android Studio. The app uses Jetpack Compose with Material 3.

### Daemon API reference

```
GET  /status                        → daemon health + version
GET  /devices                       → paired devices with connection status
POST /devices/:id/pair              → accept incoming pairing
POST /devices/:id/unpair            → remove paired device
GET  /pairing                       → current pairing state
POST /pairing/reject                → reject incoming pairing
POST /clipboard/send                → send clipboard to all connected devices
POST /clipboard/pull                → request clipboard from phone
GET  /clipboard/history             → synced clipboard entries
GET  /clipboard/latest              → latest clipboard from phone
POST /devices/:id/clipboard/send    → send clipboard to specific device
GET  /devices/:id/clipboard/latest  → latest clipboard from specific device
POST /devices/:id/file/send         → send file to device
GET  /transfers                     → all file transfers
GET  /transfers/:id                 → single transfer status
```

## Known Limitations (Alpha)

- **Local network only** — no cloud relay for cross-network connectivity
- **Large incoming files** accumulate in memory before writing to disk
- **No transfer cancellation** — once started, transfers run to completion
- **No notification mirroring** — clipboard and files only (v1 scope)
- **Android Accessibility Service** must be manually enabled for clipboard sync

## Troubleshooting

**Daemon won't start:**
- Check if ports 18734 or 19876 are in use: `lsof -i :18734`
- Check logs at `~/.raycast-android/logs/`

**Devices can't find each other:**
- Verify both devices are on the same WiFi network
- Check your router allows mDNS/Bonjour traffic (some guest networks block it)
- Try restarting the daemon and the RayLink app

**Clipboard not syncing (Phone → Mac):**
- Ensure the Accessibility Service is enabled on Android
- Check that the phone shows "Connected to [Mac name]" in the notification

**Clipboard not syncing (Mac → Phone):**
- Check that the daemon is running: `curl http://127.0.0.1:19876/status`
- Verify the device shows as "Connected" in the Devices command

## License

MIT
