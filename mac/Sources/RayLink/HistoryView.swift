import AppKit
import SwiftUI

/// Decrypted images, kept in memory only while the app runs.
private final class ThumbnailCache {
    static let shared = ThumbnailCache()
    private let cache = NSCache<NSString, NSImage>()

    func image(for item: ClipItem, in store: HistoryStore) -> NSImage? {
        guard let name = item.imageFile else { return nil }
        if let hit = cache.object(forKey: name as NSString) { return hit }
        guard let data = store.imageData(for: item), let image = NSImage(data: data) else { return nil }
        cache.setObject(image, forKey: name as NSString)
        return image
    }
}

private struct Section: Identifiable {
    let id: String
    let items: [ClipItem]
}

private func sections(for items: [ClipItem]) -> [Section] {
    let calendar = Calendar.current
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    var order: [String] = []
    var groups: [String: [ClipItem]] = [:]
    for item in items {
        let title: String
        if item.pinned {
            title = "Pinned"
        } else if calendar.isDateInToday(item.lastCopied) {
            title = "Today"
        } else if calendar.isDateInYesterday(item.lastCopied) {
            title = "Yesterday"
        } else {
            title = formatter.string(from: item.lastCopied)
        }
        if groups[title] == nil { order.append(title) }
        groups[title, default: []].append(item)
    }
    return order.map { Section(id: $0, items: groups[$0] ?? []) }
}

struct HistoryView: View {
    @ObservedObject var model: PanelModel
    @ObservedObject var store: HistoryStore
    @FocusState private var searchFocused: Bool

    var body: some View {
        let items = model.visible
        let selected = items.first { $0.id == model.selectedID } ?? items.first

        VStack(spacing: 0) {
            header
            Divider()
            if items.isEmpty {
                emptyState
            } else {
                HStack(spacing: 0) {
                    list(items, selected: selected)
                        .frame(width: 300)
                    Divider()
                    if let selected {
                        DetailView(item: selected, store: store)
                            .id(selected.id)
                    }
                }
            }
            Divider()
            footer(selected)
        }
        .overlay(alignment: .bottomTrailing) {
            if model.showActions, let selected {
                ActionsMenu(model: model, item: selected)
                    .padding(.trailing, 10)
                    .padding(.bottom, 44)
            }
        }
        .ignoresSafeArea()
        .onAppear { searchFocused = true }
        .onChange(of: model.focusTick) { _, _ in searchFocused = true }
    }

    private var header: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search clipboard history…", text: $model.query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 17))
                    .focused($searchFocused)
            }
            HStack(spacing: 6) {
                chip("All", kind: nil)
                ForEach(ClipKind.allCases, id: \.self) { chip($0.label, kind: $0) }
                Spacer()
                Text("⌘P")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 10)
    }

    private func chip(_ title: String, kind: ClipKind?) -> some View {
        let active = model.filter == kind
        return Text(title)
            .font(.system(size: 11, weight: active ? .semibold : .regular))
            .padding(.horizontal, 9)
            .padding(.vertical, 3)
            .background(active ? Color.accentColor.opacity(0.85) : Color.primary.opacity(0.07), in: Capsule())
            .foregroundStyle(active ? Color.white : Color.primary)
            .contentShape(Capsule())
            .onTapGesture { model.filter = kind }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "clipboard")
                .font(.system(size: 34))
                .foregroundStyle(.tertiary)
            Text(store.items.isEmpty ? "Nothing copied yet" : "No matching entries")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func list(_ items: [ClipItem], selected: ClipItem?) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 1) {
                    ForEach(sections(for: items)) { section in
                        Text(section.id)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                            .padding(.top, 8)
                            .padding(.bottom, 2)
                        ForEach(section.items) { item in
                            RowView(item: item, store: store, selected: item.id == selected?.id)
                                .id(item.id)
                                .onTapGesture(count: 2) {
                                    model.selectedID = item.id
                                    model.run(.paste)
                                }
                                .onTapGesture { model.selectedID = item.id }
                        }
                    }
                }
                .padding(8)
            }
            .onChange(of: model.selectedID) { _, id in
                if let id { proxy.scrollTo(id) }
            }
        }
    }

    private func footer(_ selected: ClipItem?) -> some View {
        HStack(spacing: 14) {
            if model.confirmDeleteAll {
                Label("Press ⌃⇧X again to delete all unpinned entries", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            } else if let toast = model.toast {
                Text(toast)
            } else if model.connectedDevices.isEmpty {
                Label("No phone connected", systemImage: "iphone.slash")
                    .foregroundStyle(.secondary)
            } else {
                Label(model.connectedDevices.joined(separator: ", "), systemImage: "iphone")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if selected != nil {
                hint("Paste", "↵")
                hint("Copy", "⌘↵")
                hint("Actions", "⌘K")
                    .contentShape(Rectangle())
                    .onTapGesture {
                        model.actionIndex = 0
                        model.showActions.toggle()
                    }
            }
        }
        .font(.system(size: 12))
        .lineLimit(1)
        .padding(.horizontal, 14)
        .frame(height: 36)
    }

    private func hint(_ title: String, _ keys: String) -> some View {
        HStack(spacing: 5) {
            Text(title)
            KeyCap(keys)
        }
    }
}

private struct KeyCap: View {
    let keys: String
    init(_ keys: String) { self.keys = keys }

    var body: some View {
        Text(keys)
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 5)
            .padding(.vertical, 1.5)
            .background(Color.primary.opacity(0.1), in: RoundedRectangle(cornerRadius: 4))
            .foregroundStyle(.secondary)
    }
}

private struct RowView: View {
    let item: ClipItem
    let store: HistoryStore
    let selected: Bool

    var body: some View {
        HStack(spacing: 9) {
            icon
                .frame(width: 22, height: 22)
            Text(item.title)
                .font(.system(size: 13))
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 4)
            if item.deviceName != nil {
                Image(systemName: "iphone")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
            if item.pinned {
                Image(systemName: "pin.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(.orange)
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 32)
        .background(selected ? Color.accentColor.opacity(0.22) : Color.clear, in: RoundedRectangle(cornerRadius: 7))
        .contentShape(Rectangle())
    }

    @ViewBuilder private var icon: some View {
        switch item.kind {
        case .image:
            if let image = ThumbnailCache.shared.image(for: item, in: store) {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 22, height: 22)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            } else {
                Image(systemName: item.kind.symbol).foregroundStyle(.secondary)
            }
        case .color:
            RoundedRectangle(cornerRadius: 5)
                .fill(Color(nsColor: Classifier.color(from: item.text) ?? .gray))
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.primary.opacity(0.15)))
                .frame(width: 18, height: 18)
        case .file:
            if let first = item.filePaths.first {
                Image(nsImage: NSWorkspace.shared.icon(forFile: first))
                    .resizable()
                    .frame(width: 20, height: 20)
            }
        default:
            Image(systemName: item.kind.symbol)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
        }
    }
}

private struct DetailView: View {
    let item: ClipItem
    let store: HistoryStore

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.doesRelativeDateFormatting = true
        return formatter
    }()

    var body: some View {
        VStack(spacing: 0) {
            preview
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            VStack(spacing: 0) {
                ForEach(Array(metadata.enumerated()), id: \.offset) { _, row in
                    HStack {
                        Text(row.0).foregroundStyle(.secondary)
                        Spacer()
                        Text(row.1).lineLimit(1).truncationMode(.middle)
                    }
                    .font(.system(size: 12))
                    .padding(.vertical, 4)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
        }
    }

    @ViewBuilder private var preview: some View {
        switch item.kind {
        case .image:
            if let image = ThumbnailCache.shared.image(for: item, in: store) {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .padding(14)
            } else {
                Text("Image file is missing").foregroundStyle(.secondary)
            }
        case .color:
            VStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color(nsColor: Classifier.color(from: item.text) ?? .gray))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.primary.opacity(0.15)))
                    .frame(width: 130, height: 130)
                Text(item.text.trimmingCharacters(in: .whitespacesAndNewlines))
                    .font(.system(size: 14, design: .monospaced))
                    .textSelection(.enabled)
            }
        case .file:
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(item.filePaths, id: \.self) { path in
                        HStack(spacing: 8) {
                            Image(nsImage: NSWorkspace.shared.icon(forFile: path))
                                .resizable()
                                .frame(width: 28, height: 28)
                            VStack(alignment: .leading, spacing: 1) {
                                Text((path as NSString).lastPathComponent).font(.system(size: 13))
                                Text((path as NSString).deletingLastPathComponent)
                                    .font(.system(size: 11))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.head)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
            }
        default:
            ScrollView {
                // Very long entries are previewed truncated; the full text is still pasted.
                Text(String(item.text.prefix(20_000)))
                    .font(.system(size: 12, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
            }
        }
    }

    private var metadata: [(String, String)] {
        var rows: [(String, String)] = []
        if let device = item.deviceName {
            rows.append(("Source", "\(device) (phone)"))
        } else if let app = item.sourceApp {
            rows.append(("Source", app))
        }
        rows.append(("Content type", item.kind.singular))
        switch item.kind {
        case .image:
            if let w = item.imageWidth, let h = item.imageHeight { rows.append(("Dimensions", "\(w) × \(h)")) }
            if let ocr = item.ocrText, !ocr.isEmpty {
                rows.append(("Recognized text", ocr.replacingOccurrences(of: "\n", with: " ")))
            }
        case .file:
            rows.append(("Items", "\(item.filePaths.count)"))
        default:
            rows.append(("Characters", "\(item.text.count)"))
            rows.append(("Words", "\(item.text.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).count)"))
        }
        rows.append(("Times copied", "\(item.copyCount)"))
        rows.append(("Last copied", Self.dateFormatter.string(from: item.lastCopied)))
        if item.copyCount > 1 {
            rows.append(("First copied", Self.dateFormatter.string(from: item.firstCopied)))
        }
        return rows
    }
}

private struct ActionsMenu: View {
    @ObservedObject var model: PanelModel
    let item: ClipItem

    var body: some View {
        let actions = PanelAction.available(for: item)
        VStack(spacing: 1) {
            ForEach(Array(actions.enumerated()), id: \.offset) { index, action in
                HStack(spacing: 8) {
                    Image(systemName: action.symbol)
                        .frame(width: 18)
                    Text(action.title(for: item))
                    Spacer()
                    KeyCap(action.shortcut)
                }
                .font(.system(size: 13))
                .foregroundStyle(action.isDestructive ? Color.red : Color.primary)
                .padding(.horizontal, 9)
                .frame(height: 30)
                .background(
                    index == model.actionIndex ? Color.accentColor.opacity(0.22) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 6))
                .contentShape(Rectangle())
                .onTapGesture { model.run(action) }
            }
        }
        .padding(6)
        .frame(width: 290)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.12)))
        .shadow(color: .black.opacity(0.25), radius: 14, y: 4)
    }
}
