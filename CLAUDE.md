# RayLink — Mac clipboard history with Android clipboard sync & file transfer

## Architecture
Two components communicate over local WiFi:
- **Mac App** (`mac/`) — Swift menu-bar app (AppKit + SwiftUI): clipboard history window, plus the WebSocket/TLS server and mDNS advertising built in
- **Android Companion App** (`android/`) — Kotlin/Jetpack Compose; discovers the Mac and connects as a client

## Build & Run

### Mac App
```bash
cd mac && ./build.sh && open build/RayLink.app
```
Needs only the Xcode Command Line Tools (SwiftPM, no Xcode project). History window: ⌃⌘V. Data is stored in `~/Library/Application Support/RayLink/` (`history.json`, `images/`, `identity/`).

For an isolated run that does not touch real data, start the binary with `RAYLINK_HOME=<dir>`; add `RAYLINK_HEADLESS=1` to suppress the pairing dialog.

### Android App
```bash
cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew installDebug
```
There is no system JDK; use the one bundled with Android Studio.

## Protocol
- Discovery: mDNS `_raylink._tcp` on port 18734
- Communication: JSON messages over WebSocket/TLS
- Message handling lives in `mac/Sources/RayLink/LinkServer.swift` and `android/.../Protocol.kt`
- **Important**: Android sends all body values as strings; the Mac must handle both string and native types (use explicit coercion, not casts)

## Key Design Decisions
- Local network only (no cloud relay) — privacy-first
- The Mac is the WebSocket server; Android is the client
- Mac clipboard watched via `NSPasteboard.changeCount` polling (0.4s); Accessibility Service plus a transparent activity on Android (Samsung OneUI only lets a focused app read the clipboard)
- Only the Mac ever sends `pair.accept`; an unpaired connection can do nothing but request pairing
- Files are chunked at 64KB; the Mac streams to and from disk, and sanitizes incoming file names
- Self-signed TLS certificate; Android does not pin it yet and is identified by device ID only

## Testing
No test suite. The Mac server can be exercised with any WebSocket client against `wss://127.0.0.1:18734` (self-signed certificate) speaking the protocol above.
