# RayLink

Clipboard history for macOS with a shared clipboard and file transfer to an Android phone, over the local network. No cloud, no account.

Two parts:

- **Mac app** (`mac/`) — a Swift menu-bar app: clipboard history window plus the server the phone connects to.
- **Android app** (`android/`) — Kotlin/Jetpack Compose companion that discovers the Mac and syncs with it.

## Mac app

```bash
cd mac && ./build.sh && open build/RayLink.app
```

Needs macOS 15+ and the Xcode Command Line Tools (SwiftPM; no Xcode project).

### Clipboard history

Open with **⇧⌘V**, or by launching the app again while it is running.

| Action | Keys |
|---|---|
| Paste into the active app | ↵ |
| Copy to clipboard | ⌘↵ |
| Paste as plain text | ⇧↵ |
| Actions menu | ⌘K |
| Filter by type | ⌘P |
| Pin / unpin | ⇧⌘P |
| Send to phone | ⇧⌘S |
| Delete entry / delete all unpinned | ⌃X / ⌃⇧X |

- Records text, images, files, links, emails and colors, with the source app and copy count.
- Search covers entry text, text recognized in images (on-device OCR), source app and device name.
- Content marked as concealed or transient, and anything copied from password managers, is not recorded.
- History is kept for 3 months by default (menu bar → Keep History For). Pinned entries are never pruned.

Pasting into the active app needs the Accessibility permission; without it the entry is only copied. The app is ad-hoc signed, so macOS asks for that permission again after each rebuild.

### Phone link

- The Mac advertises `_raylink._tcp` over mDNS on port 18734; the phone finds it and connects.
- A new device triggers a pairing prompt on the Mac. Paired devices reconnect on their own.
- Text copied on either side appears on the other (toggle: menu bar → Sync Clipboard Automatically).
- Files shared to RayLink on the phone land in `~/Downloads` and in the history.
- Menu bar: send the clipboard, pull the phone's clipboard, send files, unpair.

Data lives in `~/Library/Application Support/RayLink/`:

- `history.sqlite` — one row per entry, each sealed with AES-256-GCM. Only the entry ID, last-copied time and pinned flag are stored in the clear.
- `images/` — copied images, encrypted with the same key and named by content hash.
- `identity/` — TLS certificate, key, paired devices.

The encryption key is kept in the login Keychain ("RayLink clipboard history key"), not on disk. Because the app is ad-hoc signed, macOS asks for permission to use the key after each rebuild; if access is denied, history is kept in memory only and the menu says so.

## Android app

```bash
cd android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew installDebug
```

Or open `android/` in Android Studio. Requires Android 10+.

On the phone:

1. Open RayLink and tap **Start Connection**. Both devices must be on the same Wi-Fi.
2. Accept the pairing prompt on the Mac.
3. Tap **Enable Accessibility Service** and turn RayLink on, so clipboard changes are detected in the background.

Android only lets the focused app read the clipboard, so when RayLink sees a copy (a tap on Copy/Cut, a "Copied" message) it briefly opens an invisible activity to read it. Copies made without such a signal, such as Ctrl+C on a hardware keyboard, are not detected; use **Send Clipboard** in the notification for those.

Text copied on the phone is sent to the Mac; text from the Mac is placed on the phone's clipboard. Share any file or text to RayLink from the share sheet to send it to the Mac. Files from the Mac are saved to Downloads.

## Protocol

JSON messages over WebSocket/TLS; the Mac is the server.

| Type | Direction | Purpose |
|---|---|---|
| `pair.request` | phone → Mac | Identify the device and ask to pair |
| `pair.accept` / `pair.reject` | Mac → phone | Pairing result |
| `clipboard.update` | both | New clipboard text |
| `clipboard.connect` | both | Clipboard at connect time |
| `clipboard.request` | both | Ask for the current clipboard |
| `file.offer` / `file.accept` / `file.reject` | both | Start a transfer |
| `file.chunk` | both | 64 KB of base64 data, `isLast` on the final one |
| `ping` / `pong` | both | Keep-alive |

Every message is `{ id, type, timestamp, body }`. Android sends all body values as strings, so the Mac coerces types explicitly.

## Known limitations

- The phone accepts any TLS certificate and is recognized by its device ID alone; there is no certificate pinning yet. Use it on networks you trust.
- The Android app buffers incoming and outgoing files in memory, and can reorder incoming chunks, so large files from the Mac may arrive corrupted.
- Only text is synced between clipboards; images and files in the history stay on the Mac unless sent explicitly.
- The history hotkey is fixed at ⇧⌘V. It is system-wide, so it replaces "Paste and Match Style" in apps that use that shortcut.
