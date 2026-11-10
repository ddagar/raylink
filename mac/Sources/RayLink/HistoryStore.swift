import AppKit

/// Persistent clipboard history. Main-thread only.
final class HistoryStore: ObservableObject {
    @Published private(set) var items: [ClipItem] = []

    private let fileURL: URL
    let imagesDir: URL
    private var saveWork: DispatchWorkItem?
    private static let maxItems = 2000

    init() {
        let dir = Paths.dataDir
        imagesDir = dir.appendingPathComponent("images")
        fileURL = dir.appendingPathComponent("history.json")
        try? FileManager.default.createDirectory(
            at: imagesDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if let data = try? Data(contentsOf: fileURL) {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            items = (try? decoder.decode([ClipItem].self, from: data)) ?? []
        }
        prune()
    }

    func item(withHash hash: String) -> ClipItem? { items.first { $0.hash == hash } }

    /// Adds an entry, or bumps the existing one with the same content. Returns the stored entry.
    @discardableResult
    func add(_ new: ClipItem) -> ClipItem {
        if let existing = item(withHash: new.hash) {
            touch(existing.id)
            return items.first { $0.id == existing.id } ?? existing
        }
        items.insert(new, at: 0)
        prune()
        scheduleSave()
        return new
    }

    /// Marks an entry as copied again and moves it to the top.
    func touch(_ id: UUID) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        var item = items.remove(at: i)
        item.lastCopied = Date()
        item.copyCount += 1
        items.insert(item, at: 0)
        scheduleSave()
    }

    func togglePin(_ id: UUID) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        items[i].pinned.toggle()
        scheduleSave()
    }

    func setOCR(_ id: UUID, text: String) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        items[i].ocrText = text
        scheduleSave()
    }

    func delete(_ id: UUID) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        removeImage(of: items.remove(at: i))
        scheduleSave()
    }

    /// Deletes everything except pinned entries.
    func deleteAllUnpinned() {
        items.filter { !$0.pinned }.forEach(removeImage)
        items.removeAll { !$0.pinned }
        scheduleSave()
    }

    func imageURL(for item: ClipItem) -> URL? {
        item.imageFile.map { imagesDir.appendingPathComponent($0) }
    }

    func prune() {
        var removed: [ClipItem] = []
        let days = Settings.retentionDays
        if days > 0 {
            let cutoff = Date().addingTimeInterval(-Double(days) * 86400)
            removed += items.filter { !$0.pinned && $0.lastCopied < cutoff }
        }
        let expired = Set(removed.map(\.id))
        var kept = items.filter { !expired.contains($0.id) }
        while kept.count > Self.maxItems, let i = kept.lastIndex(where: { !$0.pinned }) {
            removed.append(kept.remove(at: i))
        }
        guard !removed.isEmpty else { return }
        removed.forEach(removeImage)
        items = kept
        scheduleSave()
    }

    private func removeImage(of item: ClipItem) {
        if let url = imageURL(for: item) { try? FileManager.default.removeItem(at: url) }
    }

    private func scheduleSave() {
        saveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveNow() }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
    }

    func saveNow() {
        saveWork?.cancel()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(items) else { return }
        try? data.write(to: fileURL, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }
}
