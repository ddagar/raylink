import AppKit
import CryptoKit
import Security
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// The key that encrypts the history. It lives in the login Keychain, never on disk
/// next to the data it protects.
enum HistoryKey {
    private static let service = "com.raylink.mac.history"
    private static let account = "encryption-key"

    struct KeychainError: LocalizedError {
        let status: OSStatus
        var errorDescription: String? {
            (SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)"
        }
    }

    static func load() throws -> SymmetricKey {
        // Isolated test runs keep their key in the test directory and never touch the Keychain.
        if let file = Paths.testKeyFile {
            if let data = try? Data(contentsOf: file), data.count == 32 { return SymmetricKey(data: data) }
            let key = SymmetricKey(size: .bits256)
            try FileManager.default.createDirectory(
                at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try key.withUnsafeBytes { Data($0) }.write(to: file, options: .atomic)
            return key
        }

        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        var read = query
        read[kSecReturnData as String] = true
        read[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(read as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data, data.count == 32 {
            return SymmetricKey(data: data)
        }
        // Only create a key when none exists. Any other failure (access denied, locked
        // keychain) must not replace the key, or existing history would become unreadable.
        guard status == errSecItemNotFound else { throw KeychainError(status: status) }

        let key = SymmetricKey(size: .bits256)
        query[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        query[kSecAttrLabel as String] = "RayLink clipboard history key"
        let added = SecItemAdd(query as CFDictionary, nil)
        guard added == errSecSuccess else { throw KeychainError(status: added) }
        return key
    }
}

/// Clipboard history: one row per entry in a SQLite database, each entry sealed with
/// AES-256-GCM. Images are stored as separate sealed files named by content hash.
/// Main-thread only.
final class HistoryStore: ObservableObject {
    @Published private(set) var items: [ClipItem] = []

    /// Set when the history cannot be saved to disk; entries are then kept in memory only.
    private(set) var storageError: String?

    private var db: OpaquePointer?
    private var key: SymmetricKey?
    private let imagesDir: URL
    private static let maxItems = 2000

    init() {
        let fm = FileManager.default
        let dir = Paths.dataDir
        imagesDir = dir.appendingPathComponent("images")
        try? fm.createDirectory(at: imagesDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])

        do {
            key = try HistoryKey.load()
        } catch {
            storageError = "History is not being saved: \(error.localizedDescription)"
            return
        }

        let path = dir.appendingPathComponent("history.sqlite").path
        guard sqlite3_open(path, &db) == SQLITE_OK else {
            storageError = "History is not being saved: could not open the database"
            db = nil
            return
        }
        try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
        // secure_delete overwrites removed rows so deleted entries do not linger in the file.
        exec("PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;")
        exec("""
            CREATE TABLE IF NOT EXISTS entries (
                id TEXT PRIMARY KEY,
                last_copied REAL NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                payload BLOB NOT NULL
            );
            CREATE INDEX IF NOT EXISTS entries_last_copied ON entries(last_copied);
            """)

        items = loadAll()
        importLegacyJSON(from: dir)
        prune()
    }

    deinit { close() }

    func close() {
        if let db { sqlite3_close(db) }
        db = nil
    }

    // MARK: - Entries

    func item(withHash hash: String) -> ClipItem? { items.first { $0.hash == hash } }

    /// Adds an entry, or bumps the existing one with the same content. Returns the stored entry.
    @discardableResult
    func add(_ new: ClipItem) -> ClipItem {
        if let existing = item(withHash: new.hash) {
            touch(existing.id)
            return items.first { $0.id == existing.id } ?? existing
        }
        items.insert(new, at: 0)
        save(new)
        prune()
        return new
    }

    /// Marks an entry as copied again and moves it to the top.
    func touch(_ id: UUID) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        var item = items.remove(at: i)
        item.lastCopied = Date()
        item.copyCount += 1
        items.insert(item, at: 0)
        save(item)
    }

    func togglePin(_ id: UUID) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        items[i].pinned.toggle()
        save(items[i])
    }

    func setOCR(_ id: UUID, text: String) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        items[i].ocrText = text
        save(items[i])
    }

    func delete(_ id: UUID) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        remove([items.remove(at: i)])
    }

    /// Deletes everything except pinned entries.
    func deleteAllUnpinned() {
        let doomed = items.filter { !$0.pinned }
        items.removeAll { !$0.pinned }
        remove(doomed)
    }

    func prune() {
        var doomed: [ClipItem] = []
        let days = Settings.retentionDays
        if days > 0 {
            let cutoff = Date().addingTimeInterval(-Double(days) * 86400)
            doomed += items.filter { !$0.pinned && $0.lastCopied < cutoff }
        }
        let expired = Set(doomed.map(\.id))
        var kept = items.filter { !expired.contains($0.id) }
        while kept.count > Self.maxItems, let i = kept.lastIndex(where: { !$0.pinned }) {
            doomed.append(kept.remove(at: i))
        }
        guard !doomed.isEmpty else { return }
        items = kept
        remove(doomed)
    }

    // MARK: - Images

    /// Stores PNG data encrypted and returns the file name to keep in the entry.
    func saveImage(_ png: Data, hash: String) -> String? {
        guard let sealed = seal(png) else { return nil }
        let name = hash + ".img"
        guard (try? sealed.write(to: imagesDir.appendingPathComponent(name), options: .atomic)) != nil else {
            return nil
        }
        return name
    }

    func imageData(for item: ClipItem) -> Data? {
        guard let name = item.imageFile,
              let sealed = try? Data(contentsOf: imagesDir.appendingPathComponent(name)) else { return nil }
        return open(sealed)
    }

    // MARK: - Encryption

    private func seal(_ data: Data) -> Data? {
        guard let key else { return nil }
        return try? AES.GCM.seal(data, using: key).combined
    }

    private func open(_ data: Data) -> Data? {
        guard let key, let box = try? AES.GCM.SealedBox(combined: data) else { return nil }
        return try? AES.GCM.open(box, using: key)
    }

    // MARK: - Database

    private func exec(_ sql: String) {
        sqlite3_exec(db, sql, nil, nil, nil)
    }

    private func loadAll() -> [ClipItem] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT payload FROM entries ORDER BY last_copied DESC, rowid DESC", -1, &statement, nil) == SQLITE_OK else {
            return []
        }
        defer { sqlite3_finalize(statement) }
        var loaded: [ClipItem] = []
        let decoder = JSONDecoder()
        while sqlite3_step(statement) == SQLITE_ROW {
            guard let bytes = sqlite3_column_blob(statement, 0) else { continue }
            let sealed = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))
            if let plain = open(sealed), let item = try? decoder.decode(ClipItem.self, from: plain) {
                loaded.append(item)
            }
        }
        return loaded
    }

    private func save(_ item: ClipItem) {
        guard db != nil, let plain = try? JSONEncoder().encode(item), let sealed = seal(plain) else { return }
        var statement: OpaquePointer?
        let sql = "INSERT OR REPLACE INTO entries (id, last_copied, pinned, payload) VALUES (?, ?, ?, ?)"
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, item.id.uuidString, -1, SQLITE_TRANSIENT)
        sqlite3_bind_double(statement, 2, item.lastCopied.timeIntervalSince1970)
        sqlite3_bind_int(statement, 3, item.pinned ? 1 : 0)
        sealed.withUnsafeBytes { buffer in
            _ = sqlite3_bind_blob(statement, 4, buffer.baseAddress, Int32(buffer.count), SQLITE_TRANSIENT)
        }
        sqlite3_step(statement)
    }

    private func remove(_ doomed: [ClipItem]) {
        guard !doomed.isEmpty else { return }
        exec("BEGIN")
        for item in doomed {
            var statement: OpaquePointer?
            if sqlite3_prepare_v2(db, "DELETE FROM entries WHERE id = ?", -1, &statement, nil) == SQLITE_OK {
                sqlite3_bind_text(statement, 1, item.id.uuidString, -1, SQLITE_TRANSIENT)
                sqlite3_step(statement)
            }
            sqlite3_finalize(statement)
        }
        exec("COMMIT")
        // An image file is shared by content hash; drop it only when no entry uses it any more.
        for name in Set(doomed.compactMap(\.imageFile)) where !items.contains(where: { $0.imageFile == name }) {
            try? FileManager.default.removeItem(at: imagesDir.appendingPathComponent(name))
        }
    }

    // MARK: - Migration

    /// Earlier versions kept the history as plain `history.json` plus PNG files. Move those
    /// entries into the encrypted store and delete the plaintext copies.
    private func importLegacyJSON(from dir: URL) {
        let fm = FileManager.default
        let legacy = dir.appendingPathComponent("history.json")
        guard db != nil, let data = try? Data(contentsOf: legacy) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let old = try? decoder.decode([ClipItem].self, from: data) else { return }

        var imported: [ClipItem] = []
        exec("BEGIN")
        for var entry in old where self.item(withHash: entry.hash) == nil {
            if let name = entry.imageFile {
                let png = imagesDir.appendingPathComponent(name)
                guard let bytes = try? Data(contentsOf: png),
                      let sealedName = saveImage(bytes, hash: entry.hash) else { continue }
                entry.imageFile = sealedName
            }
            save(entry)
            imported.append(entry)
        }
        exec("COMMIT")

        items = (items + imported).sorted { $0.lastCopied > $1.lastCopied }
        try? fm.removeItem(at: legacy)
        for file in (try? fm.contentsOfDirectory(at: imagesDir, includingPropertiesForKeys: nil)) ?? []
        where file.pathExtension == "png" {
            try? fm.removeItem(at: file)
        }
    }
}
