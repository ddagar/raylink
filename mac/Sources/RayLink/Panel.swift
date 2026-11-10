import AppKit
import SwiftUI

enum PanelAction {
    case paste, copy, pastePlain, sendToPhone, togglePin, delete, deleteAll

    func title(for item: ClipItem) -> String {
        switch self {
        case .paste: return "Paste to Active App"
        case .copy: return "Copy to Clipboard"
        case .pastePlain: return "Paste as Plain Text"
        case .sendToPhone: return "Send to Phone"
        case .togglePin: return item.pinned ? "Unpin Entry" : "Pin Entry"
        case .delete: return "Delete Entry"
        case .deleteAll: return "Delete All Entries"
        }
    }

    var shortcut: String {
        switch self {
        case .paste: return "↵"
        case .copy: return "⌘↵"
        case .pastePlain: return "⇧↵"
        case .sendToPhone: return "⇧⌘S"
        case .togglePin: return "⇧⌘P"
        case .delete: return "⌃X"
        case .deleteAll: return "⌃⇧X"
        }
    }

    var symbol: String {
        switch self {
        case .paste: return "arrow.down.doc"
        case .copy: return "doc.on.doc"
        case .pastePlain: return "textformat"
        case .sendToPhone: return "iphone.and.arrow.forward"
        case .togglePin: return "pin"
        case .delete: return "trash"
        case .deleteAll: return "trash.slash"
        }
    }

    var isDestructive: Bool { self == .delete || self == .deleteAll }

    static func available(for item: ClipItem) -> [PanelAction] {
        var actions: [PanelAction] = [.paste, .copy]
        if item.kind.isTextual && (item.rtf != nil || item.html != nil) { actions.append(.pastePlain) }
        if item.kind != .image { actions.append(.sendToPhone) }
        return actions + [.togglePin, .delete, .deleteAll]
    }
}

final class PanelModel: ObservableObject {
    let store: HistoryStore

    @Published var query = "" { didSet { if query != oldValue { selectFirst() } } }
    @Published var filter: ClipKind? { didSet { if filter != oldValue { selectFirst() } } }
    @Published var selectedID: UUID?
    @Published var showActions = false
    @Published var actionIndex = 0
    @Published var confirmDeleteAll = false
    @Published var toast: String?
    @Published var focusTick = 0
    /// Names of currently connected paired devices.
    @Published var connectedDevices: [String] = []

    var perform: (PanelAction, ClipItem) -> Void = { _, _ in }
    private var toastWork: DispatchWorkItem?

    init(store: HistoryStore) { self.store = store }

    /// Entries matching the search and type filter, pinned first.
    var visible: [ClipItem] {
        let q = query.trimmingCharacters(in: .whitespaces)
        let base = store.items.filter { (filter == nil || $0.kind == filter) && (q.isEmpty || $0.matches(q)) }
        return base.filter(\.pinned) + base.filter { !$0.pinned }
    }

    var selected: ClipItem? {
        let items = visible
        return items.first { $0.id == selectedID } ?? items.first
    }

    func reset() {
        query = ""
        filter = nil
        showActions = false
        confirmDeleteAll = false
        toast = nil
        selectFirst()
        focusTick += 1
    }

    func selectFirst() { selectedID = visible.first?.id }

    func move(_ delta: Int) {
        let items = visible
        guard !items.isEmpty else { return }
        let current = items.firstIndex { $0.id == selectedID } ?? 0
        selectedID = items[min(max(current + delta, 0), items.count - 1)].id
    }

    func cycleFilter() {
        let order: [ClipKind?] = [nil] + ClipKind.allCases.map { $0 }
        let i = order.firstIndex(of: filter) ?? 0
        filter = order[(i + 1) % order.count]
    }

    func run(_ action: PanelAction) {
        guard let item = selected else { return }
        showActions = false
        if action == .deleteAll {
            if confirmDeleteAll {
                confirmDeleteAll = false
                perform(.deleteAll, item)
            } else {
                confirmDeleteAll = true
            }
            return
        }
        confirmDeleteAll = false
        // Keep the cursor in place when the selected row disappears.
        if action == .delete {
            let items = visible
            if let i = items.firstIndex(where: { $0.id == item.id }) {
                selectedID = i + 1 < items.count ? items[i + 1].id : (i > 0 ? items[i - 1].id : nil)
            }
        }
        perform(action, item)
    }

    func showToast(_ message: String) {
        toast = message
        toastWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.toast = nil }
        toastWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }
}

private final class KeyPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// Floating history window. It takes keyboard focus without activating the app,
/// so the app the user was typing in stays frontmost and receives the paste.
final class PanelController: NSObject, NSWindowDelegate {
    private let panel: NSPanel
    private let model: PanelModel
    private var keyMonitor: Any?

    init(model: PanelModel) {
        self.model = model
        panel = KeyPanel(
            contentRect: NSRect(x: 0, y: 0, width: 780, height: 500),
            styleMask: [.nonactivatingPanel, .titled, .fullSizeContentView],
            backing: .buffered, defer: false)
        super.init()

        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.delegate = self
        [.closeButton, .miniaturizeButton, .zoomButton].forEach { panel.standardWindowButton($0)?.isHidden = true }

        let background = NSVisualEffectView()
        background.material = .popover
        background.blendingMode = .behindWindow
        background.state = .active
        let host = NSHostingView(rootView: HistoryView(model: model, store: model.store))
        host.sizingOptions = []
        host.frame = background.bounds
        host.autoresizingMask = [.width, .height]
        background.addSubview(host)
        panel.contentView = background

        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.panel.isKeyWindow else { return event }
            return self.handleKey(event) ? nil : event
        }
    }

    var isVisible: Bool { panel.isVisible }

    func toggle() { isVisible ? close() : show() }

    func show() {
        model.reset()
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        if let area = screen?.visibleFrame {
            let size = panel.frame.size
            panel.setFrameOrigin(NSPoint(
                x: area.midX - size.width / 2,
                y: area.minY + (area.height - size.height) * 0.62))
        }
        panel.orderFrontRegardless()
        panel.makeKey()
    }

    func close() { panel.orderOut(nil) }

    func windowDidResignKey(_ notification: Notification) { close() }

    /// Returns true when the key was consumed.
    private func handleKey(_ event: NSEvent) -> Bool {
        let mods = event.modifierFlags.intersection([.command, .shift, .control, .option])
        let key = Int(event.keyCode)
        let up = 126, down = 125, enter = 36, keypadEnter = 76, escape = 53
        let kKey = 40, pKey = 35, xKey = 7, sKey = 1

        if model.showActions {
            guard let item = model.selected else { model.showActions = false; return true }
            let actions = PanelAction.available(for: item)
            switch key {
            case up: model.actionIndex = max(model.actionIndex - 1, 0)
            case down: model.actionIndex = min(model.actionIndex + 1, actions.count - 1)
            case enter, keypadEnter: model.run(actions[min(model.actionIndex, actions.count - 1)])
            default: model.showActions = false
            }
            return true
        }

        // Any key other than the confirming shortcut cancels a pending "delete all".
        if model.confirmDeleteAll && !(key == xKey && mods == [.control, .shift]) {
            model.confirmDeleteAll = false
        }

        switch (key, mods) {
        case (up, []): model.move(-1)
        case (down, []): model.move(1)
        case (enter, []), (keypadEnter, []): model.run(.paste)
        case (enter, [.command]), (keypadEnter, [.command]): model.run(.copy)
        case (enter, [.shift]), (keypadEnter, [.shift]): model.run(.pastePlain)
        case (escape, _):
            if model.query.isEmpty { close() } else { model.query = "" }
        case (kKey, [.command]):
            guard model.selected != nil else { return true }
            model.actionIndex = 0
            model.showActions = true
        case (pKey, [.command]): model.cycleFilter()
        case (pKey, [.command, .shift]): model.run(.togglePin)
        case (sKey, [.command, .shift]): model.run(.sendToPhone)
        case (xKey, [.control]): model.run(.delete)
        case (xKey, [.control, .shift]): model.run(.deleteAll)
        default: return false
        }
        return true
    }
}
