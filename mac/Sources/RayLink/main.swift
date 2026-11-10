import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Combine
import ServiceManagement

private final class ActionItem: NSMenuItem {
    private var handler: (() -> Void)?

    convenience init(_ title: String, checked: Bool = false, _ handler: @escaping () -> Void) {
        self.init(title: title, action: #selector(fire), keyEquivalent: "")
        self.target = self
        self.handler = handler
        self.state = checked ? .on : .off
    }

    @objc private func fire() { handler?() }
}

final class AppController: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let headless = ProcessInfo.processInfo.environment["RAYLINK_HEADLESS"] != nil
    private var store: HistoryStore!
    private var monitor: PasteboardMonitor!
    private var server: LinkServer?
    private var serverError: String?
    private var model: PanelModel!
    private var panel: PanelController!
    private var hotKey: HotKey?
    private var statusItem: NSStatusItem!
    private var subscriptions = Set<AnyCancellable>()
    private var promptQueue: [PeerInfo] = []
    private var prompting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let bundleID = Bundle.main.bundleIdentifier,
           NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).count > 1 {
            NSApp.terminate(nil)
            return
        }

        installEditMenu()
        store = HistoryStore()
        monitor = PasteboardMonitor(store: store)
        model = PanelModel(store: store)
        model.perform = { [weak self] action, item in self?.perform(action, item) }
        panel = PanelController(model: model)

        startServer()
        monitor.onLocalText = { [weak self] text in
            if Settings.autoSync { self?.server?.broadcastClipboard(text) }
        }
        monitor.start()

        // ⇧⌘V
        hotKey = HotKey(keyCode: kVK_ANSI_V, modifiers: shiftKey | cmdKey) { [weak self] in
            self?.panel.toggle()
        }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        updateStatusIcon()

        Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { [weak self] _ in self?.store.prune() }
    }

    /// Opening the app again while it is running shows the history window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        panel?.show()
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        store?.close()
    }

    private func startServer() {
        do {
            let server = LinkServer(identity: try Identity.load(), devices: DeviceStore())
            server.clipboardProvider = { [weak self] in self?.monitor.currentText }
            server.onClipboard = { [weak self] text, device, apply in
                guard let self else { return }
                if apply {
                    guard Settings.autoSync else { return }
                    self.monitor.writeRemote(text)
                }
                var item = ClipItem(kind: Classifier.kind(for: text), text: text, hash: PasteboardMonitor.textHash(text))
                item.deviceName = device
                self.store.add(item)
            }
            server.onFileReceived = { [weak self] url, device in
                var item = ClipItem(kind: .file, text: url.path, hash: sha256Hex(Data(("f:" + url.path).utf8)))
                item.deviceName = device
                self?.store.add(item)
                NSSound(named: "Glass")?.play()
            }
            server.onPairRequest = { [weak self] peer in self?.promptPairing(peer) }
            server.$connected
                .sink { [weak self] peers in
                    self?.model.connectedDevices = peers.map(\.name)
                    self?.updateStatusIcon(connected: !peers.isEmpty)
                }
                .store(in: &subscriptions)
            server.start()
            self.server = server
        } catch {
            serverError = error.localizedDescription
        }
    }

    // MARK: - Panel actions

    private func perform(_ action: PanelAction, _ item: ClipItem) {
        switch action {
        case .paste, .pastePlain, .copy:
            monitor.write(item, plainOnly: action == .pastePlain)
            store.touch(item.id)
            if Settings.autoSync, item.kind.isTextual { server?.broadcastClipboard(item.text) }
            panel.close()
            guard action != .copy else { return }
            if AXIsProcessTrusted() {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { PasteboardMonitor.sendPaste() }
            } else {
                // The entry is on the clipboard already; pasting for the user needs this permission.
                let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
                _ = AXIsProcessTrustedWithOptions(options)
            }
        case .sendToPhone:
            guard let server, !server.connected.isEmpty else {
                model.showToast("No phone connected")
                return
            }
            if item.kind == .file {
                let sent = item.filePaths.filter { server.sendFile(URL(fileURLWithPath: $0)) }.count
                model.showToast(sent > 0 ? "Sending \(sent) file\(sent == 1 ? "" : "s") to phone" : "Could not read file")
            } else {
                server.broadcastClipboard(item.text)
                model.showToast("Sent to phone")
            }
        case .togglePin:
            store.togglePin(item.id)
        case .delete:
            store.delete(item.id)
        case .deleteAll:
            store.deleteAllUnpinned()
            model.selectFirst()
        }
    }

    // MARK: - Pairing

    private func promptPairing(_ peer: PeerInfo) {
        guard !headless else { return }
        promptQueue.append(peer)
        showNextPrompt()
    }

    private func showNextPrompt() {
        guard !prompting, !promptQueue.isEmpty else { return }
        let peer = promptQueue.removeFirst()
        prompting = true
        let alert = NSAlert()
        alert.messageText = "Pair with “\(peer.name)”?"
        alert.informativeText = """
            A device at \(peer.address) wants to connect to RayLink. Once paired it can read and \
            replace this Mac's clipboard and send files to your Downloads folder.

            Only accept if you just started the connection on your own phone.
            """
        alert.addButton(withTitle: "Pair")
        alert.addButton(withTitle: "Reject")
        NSApp.activate(ignoringOtherApps: true)
        let accepted = alert.runModal() == .alertFirstButtonReturn
        if accepted { server?.acceptPairing(peer.id) } else { server?.rejectPairing(peer.id) }
        prompting = false
        showNextPrompt()
    }

    // MARK: - Menu bar

    private func updateStatusIcon(connected: Bool = false) {
        let name = connected ? "clipboard.fill" : "clipboard"
        statusItem?.button?.image = NSImage(systemSymbolName: name, accessibilityDescription: "RayLink")
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()

        let open = ActionItem("Clipboard History") { [weak self] in self?.panel.show() }
        open.keyEquivalent = "v"
        open.keyEquivalentModifierMask = [.shift, .command]
        menu.addItem(open)
        if hotKey?.isRegistered == false {
            menu.addItem(disabled("⇧⌘V is taken by another app"))
        }
        if let problem = store.storageError {
            menu.addItem(disabled(problem))
        }
        menu.addItem(.separator())

        if let server {
            for peer in server.pending {
                let item = NSMenuItem(title: "Pairing request: \(peer.name)", action: nil, keyEquivalent: "")
                let sub = NSMenu()
                sub.addItem(ActionItem("Pair") { server.acceptPairing(peer.id) })
                sub.addItem(ActionItem("Reject") { server.rejectPairing(peer.id) })
                item.submenu = sub
                menu.addItem(item)
            }
            let online = Set(server.connected.map(\.deviceId))
            let devices = server.devices.all
            if devices.isEmpty && server.pending.isEmpty {
                menu.addItem(disabled("No paired devices — start the connection on your phone"))
            }
            for device in devices {
                let state = online.contains(device.id) ? "Connected" : "Not connected"
                let item = NSMenuItem(title: "\(device.name) — \(state)", action: nil, keyEquivalent: "")
                let sub = NSMenu()
                sub.addItem(ActionItem("Unpair") { server.unpair(device.id) })
                item.submenu = sub
                menu.addItem(item)
            }
            if online.isEmpty { menu.addItem(disabled(server.status)) }
            menu.addItem(.separator())

            let hasPeer = !online.isEmpty
            let sendClip = ActionItem("Send Clipboard to Phone") { [weak self] in
                if let text = self?.monitor.currentText, !text.isEmpty { server.broadcastClipboard(text) }
            }
            let pull = ActionItem("Pull Clipboard from Phone") { server.requestClipboard() }
            let sendFile = ActionItem("Send File to Phone…") { [weak self] in self?.chooseFilesToSend() }
            for item in [sendClip, pull, sendFile] {
                if !hasPeer {
                    item.action = nil
                    item.target = nil
                }
                menu.addItem(item)
            }
        } else {
            menu.addItem(disabled("Phone link unavailable: \(serverError ?? "unknown error")"))
        }
        menu.addItem(.separator())

        menu.addItem(ActionItem("Sync Clipboard Automatically", checked: Settings.autoSync) {
            Settings.autoSync.toggle()
        })
        let keep = NSMenuItem(title: "Keep History For", action: nil, keyEquivalent: "")
        let keepMenu = NSMenu()
        for (title, days) in Settings.retentionOptions {
            keepMenu.addItem(ActionItem(title, checked: Settings.retentionDays == days) { [weak self] in
                Settings.retentionDays = days
                self?.store.prune()
            })
        }
        keep.submenu = keepMenu
        menu.addItem(keep)
        if Bundle.main.bundleIdentifier != nil {
            menu.addItem(ActionItem("Launch at Login", checked: SMAppService.mainApp.status == .enabled) {
                if SMAppService.mainApp.status == .enabled {
                    try? SMAppService.mainApp.unregister()
                } else {
                    try? SMAppService.mainApp.register()
                }
            })
        }
        menu.addItem(.separator())
        menu.addItem(ActionItem("Quit RayLink") { NSApp.terminate(nil) })
    }

    private func disabled(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    private func chooseFilesToSend() {
        let open = NSOpenPanel()
        open.allowsMultipleSelection = true
        open.canChooseDirectories = false
        open.prompt = "Send"
        NSApp.activate(ignoringOtherApps: true)
        guard open.runModal() == .OK else { return }
        open.urls.forEach { server?.sendFile($0) }
    }

    /// A menu-bar app has no visible main menu, but text fields still route ⌘C/⌘V/⌘A through it.
    private func installEditMenu() {
        let main = NSMenu()
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
private let controller = AppController()
app.delegate = controller
app.setActivationPolicy(.accessory)
app.run()
