# RayLink - Android Link for Raycast

**Clipboard sync and file transfer between your Mac and Android phone, right from Raycast.**

RayLink is a Raycast extension that brings Phone Link-style functionality to macOS. It provides bidirectional clipboard sync and file transfer over your local WiFi network — no cloud, no account, no subscription. Your data never leaves your network.

Tested on MacBook Pro + Samsung Galaxy Z Fold 5.

## Features

### Clipboard Sync
- **Automatic bidirectional sync** — copy on your Mac, paste on your phone (and vice versa)
- **Mac to Phone**: Detected automatically every 500ms via clipboard polling
- **Phone to Mac**: Triple detection — Accessibility Service, ClipboardManager listener, and 1-second polling fallback (works on Samsung OneUI)
- **Echo suppression** — time-windowed deduplication prevents clipboard ping-pong
- **Clipboard history** — browse all synced entries with timestamps, source device, and "Send to Phone" action
- **Sensitive content filtering** — skips clipboard entries marked as sensitive on Android 13+
- **Notification action** — tap "Send Clipboard" in the Android notification for manual send

### File Transfer
- **Mac to Phone**: Select files in Finder, right-click > Quick Actions > "Send to Phone", or use Raycast command
- **Phone to Mac**: Use Android's share sheet, select RayLink
- **Received files** appear directly in phone's **Downloads** folder (via MediaStore API)
- **Large file support** — streaming transfer for files >10MB (64KB chunks)
- **Progress tracking** — animated toast shows transfer progress with completion status
- **Auto-accept** — incoming file transfers are accepted automatically

### Device Management
- **Zero-config discovery** — devices find each other via mDNS on your local network
- **Secure pairing** — 6-digit verification code derived from TLS certificate fingerprints
- **Auto-reconnect** — reconnects automatically with exponential backoff when connection drops
- **Menu bar status** — persistent icon shows connection status, quick actions, recent transfers, and clipboard history

## Quick Start

```bash
git clone https://github.com/yourusername/raycast-android.git
cd raycast-android
./setup.sh
```

This installs dependencies, builds the daemon, starts it, and opens the Raycast extension.

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

| Component | Tech | Purpose |
|-----------|------|---------|
| **Raycast Extension** | TypeScript, React | UI — 6 commands + menu bar |
| **Helper Daemon** | Node.js, TypeScript | Persistent background service — TLS WebSocket server, mDNS, clipboard monitor |
| **Android App** | Kotlin, Jetpack Compose | Companion app — Accessibility Service, foreground service, share receiver |

## Requirements

- **Mac**: macOS 12+, [Raycast](https://raycast.com), Node.js 18+
- **Android**: Android 10+ (API 29)
- **Network**: Both devices on the same WiFi network

## Installation

### Option A: Quick setup (recommended)

```bash
git clone https://github.com/yourusername/raycast-android.git
cd raycast-android
./setup.sh
```

### Option B: Manual setup

#### 1. Install dependencies

```bash
npm install
cd daemon && npm install && cd ..
```

#### 2. Build and start the daemon

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

#### 3. Install the Raycast extension

```bash
npm run dev
```

This opens the extension in Raycast. Search for "Android Link" to verify it loaded.

#### 4. Build and install the Android app

**Android Studio:**
1. Open the `android/` directory in Android Studio
2. Connect your phone via USB or wireless debugging
3. Click Run

**Command line:**
```bash
cd android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew assembleDebug

# Install via USB or wireless debugging
$ANDROID_HOME/platform-tools/adb install app/build/outputs/apk/debug/app-debug.apk
```

#### 5. Install Finder Quick Action (optional)

To add "Send to Phone" to Finder's right-click menu:
```bash
# Run send-to-phone.sh once via Automator:
# 1. Open Automator → New → Quick Action
# 2. Set "Workflow receives" to "files or folders" in "Finder"
# 3. Add "Run Shell Script" action, set "Pass input" to "as arguments"
# 4. Paste: /path/to/raycast-android/send-to-phone.sh "$@"
# 5. Save as "Send to Phone"
```

### 6. Connect your devices

1. Open RayLink on your Android phone
2. Tap **Enable Accessibility Service** and toggle it on
3. Tap **Start Connection**
4. Your Mac appears automatically (same WiFi required)
5. In Raycast, open **Devices** — you'll see a pairing request with a 6-digit code
6. Verify the code matches on both devices and accept

Done! Clipboard syncs automatically in both directions.

## Usage

### Raycast Commands

| Command | Description |
|---------|-------------|
| **Devices** | View paired devices, accept pairing requests, setup guide |
| **Send Clipboard to Phone** | Push Mac clipboard to your phone |
| **Pull Clipboard from Phone** | Request phone's clipboard |
| **Send File to Phone** | Send Finder-selected files to phone |
| **Clipboard History** | Browse synced clipboard entries with copy/paste/send actions |
| **Android Link Status** | Menu bar: connection status, quick actions, recent transfers |

### Sending Files

**Mac to Phone:**
- **Raycast**: Select files in Finder → open Raycast → "Send File to Phone"
- **Finder context menu**: Right-click files → Quick Actions → "Send to Phone"
- Files arrive in phone's **Downloads** folder

**Phone to Mac:**
- Open any file → tap Share → select **RayLink**
- Files save to `~/Downloads` on Mac (configurable in preferences)

### Preferences

| Setting | Default | Description |
|---------|---------|-------------|
| Download Directory | `~/Downloads` | Where received files are saved on Mac |
| Auto Sync Clipboard | Enabled | Automatically sync clipboard in background |
| Show Notifications | Enabled | Show HUD notifications when clipboard syncs |

### Switching Between Macs

RayLink connects to one Mac at a time. To switch:
1. On the phone, tap **Stop Connection** in RayLink
2. Ensure the daemon is running on the target Mac
3. Tap **Start Connection** — it discovers the active Mac on the network

Both Macs can be paired simultaneously — the phone connects to whichever one is running the daemon.

## Protocol

RayLink uses a custom JSON-over-WebSocket protocol with TLS encryption:

- **Discovery**: mDNS service type `_raylink._tcp` on port 18734
- **Transport**: WebSocket over TLS 1.3 with self-signed certificates
- **Pairing**: Certificate exchange + SHA-256 derived 6-digit verification code
- **Clipboard**: `clipboard.update` / `clipboard.connect` messages
- **Files**: `file.offer` → `file.accept` → `file.chunk` (64KB base64 chunks)
- **Keepalive**: `ping` / `pong` every 30 seconds

## Security

- **TLS encryption** on all communication (self-signed RSA 2048-bit certificates)
- **Certificate pinning** after pairing — only previously trusted devices can connect
- **Local network only** — data never leaves your WiFi network
- **No cloud relay** — direct device-to-device communication
- **No accounts** — no sign-up, no third-party servers
- **Sensitive content** — clipboard entries marked `IS_SENSITIVE` on Android 13+ are skipped

## Project Structure

```
raycast-android/
├── setup.sh                         # One-line setup script
├── send-to-phone.sh                 # Finder Quick Action helper
├── package.json                     # Raycast extension manifest
├── src/                             # Raycast Extension (TypeScript/React)
│   ├── devices.tsx                  #   Device management + setup wizard
│   ├── send-clipboard.ts           #   Send clipboard command
│   ├── pull-clipboard.ts           #   Pull clipboard command
│   ├── send-file.ts                #   Send file with progress tracking
│   ├── clipboard-history.tsx       #   Clipboard history list
│   ├── status.tsx                  #   Menu bar status + auto-sync
│   └── lib/
│       ├── daemon-client.ts        #   HTTP client for daemon API
│       ├── daemon-manager.ts       #   Daemon lifecycle (start/stop)
│       ├── preferences.ts          #   Extension preferences
│       └── types.ts                #   Shared TypeScript types
├── daemon/                          # Node.js Helper Daemon
│   ├── src/
│   │   ├── index.ts                #   Entry point + startup
│   │   ├── server.ts               #   Local HTTP API (port 19876)
│   │   ├── websocket.ts            #   TLS WebSocket server (port 18734)
│   │   ├── discovery.ts            #   mDNS advertisement
│   │   ├── pairing.ts              #   Pairing flow + verification codes
│   │   ├── certificate.ts          #   TLS certificate generation
│   │   ├── clipboard.ts            #   macOS clipboard monitor + write queue
│   │   ├── file-transfer.ts        #   Chunked file send/receive + streaming
│   │   ├── device-store.ts         #   Paired device persistence
│   │   └── protocol.ts             #   Message types + serialization
│   └── com.raycast-android.daemon.plist
└── android/                         # Android Companion App (Kotlin)
    └── app/src/main/java/com/raylink/
        ├── MainActivity.kt          #   Main UI (Jetpack Compose)
        ├── network/
        │   ├── Protocol.kt          #   Message types + JSON handling
        │   ├── WebSocketClient.kt   #   OkHttp WSS + auto-reconnect
        │   ├── MdnsDiscovery.kt     #   NSD service discovery
        │   └── CertificateManager.kt #  TLS + device trust store
        ├── service/
        │   ├── ConnectionService.kt              # Foreground service + clipboard polling
        │   └── ClipboardAccessibilityService.kt  # Clipboard event detection
        └── receiver/
            ├── ShareReceiverActivity.kt  # Android share intent handler
            └── BootReceiver.kt           # Auto-start on boot
```

## Development

```bash
# Daemon with auto-reload
cd daemon && npm run dev

# Raycast extension
npm run dev

# Android
# Open android/ in Android Studio
```

### Daemon API

```
GET  /status                        → daemon health + version
GET  /devices                       → paired devices with connection status
POST /devices/:id/pair              → accept incoming pairing
POST /devices/:id/unpair            → remove paired device
GET  /pairing                       → current pairing state
POST /pairing/reject                → reject incoming pairing
POST /clipboard/send                → send clipboard to connected devices
POST /clipboard/pull                → request clipboard from phone
GET  /clipboard/history             → synced clipboard entries
GET  /clipboard/latest              → latest clipboard from phone
POST /devices/:id/clipboard/send    → send clipboard to specific device
GET  /devices/:id/clipboard/latest  → latest clipboard from specific device
POST /devices/:id/file/send         → send file to device (body: {filePath})
GET  /transfers                     → all file transfers
GET  /transfers/:id                 → single transfer status
```

## Resource Usage

Measured on MacBook Pro + Samsung Galaxy Z Fold 5 with one device connected, idle.

### Mac Daemon (Node.js)

| Metric | Value |
|--------|-------|
| Memory (RSS) | ~77 MB |
| CPU (idle) | 0.1% |
| Network (idle) | ~12 KB/s in, ~8 KB/s out |
| Open sockets | 3 (WSS, phone, HTTP API) |
| Disk (daemon + deps) | 43 MB |

### Android App

| Metric | Value |
|--------|-------|
| APK size | 25 MB |
| Memory (PSS) | ~64 MB |
| Battery (wifi) | 0.08 mAh |
| Battery (CPU, background) | ~6 mAh |

### Raycast Extension

| Metric | Value |
|--------|-------|
| Source code | 52 KB |
| Menu bar polling | 3 HTTP calls every 10s |

The extension is lightweight. The daemon uses less CPU than a typical browser tab. The Android app uses less memory than Telegram. Clipboard polling (500ms on Mac, 1s on Android) is the main ongoing cost but negligible for CPU and battery.

## Known Limitations

- **Local network only** — no cloud relay for cross-network use
- **Large incoming files** accumulate in memory before writing to disk
- **No transfer cancellation** mid-flight
- **No notification mirroring** — clipboard and files only
- **Accessibility Service** must be manually re-enabled after app updates on Android

## Troubleshooting

**Daemon won't start:**
- Check if ports are in use: `lsof -i :18734` or `lsof -i :19876`
- The daemon will log "Port already in use" if another instance is running

**Devices can't find each other:**
- Verify both devices are on the same WiFi network
- Some routers block mDNS on guest networks — use the main network
- Restart the daemon and the RayLink app

**Clipboard not syncing (Phone to Mac):**
- Re-enable the Accessibility Service (Settings > Accessibility > RayLink)
- Verify the notification shows "Connected to [Mac name]"
- Tap "Send Clipboard" in the notification as a manual fallback

**Clipboard not syncing (Mac to Phone):**
- Check daemon is running: `curl http://127.0.0.1:19876/status`
- Check device is connected: `curl http://127.0.0.1:19876/devices`

**Files not appearing on phone:**
- Received files go to the **Downloads** folder (check Samsung My Files > Downloads)

## License

MIT
