import AppKit
import CryptoKit

enum ClipKind: String, Codable, CaseIterable {
    case text, image, file, link, email, color

    var label: String {
        switch self {
        case .text: return "Text"
        case .image: return "Images"
        case .file: return "Files"
        case .link: return "Links"
        case .email: return "Emails"
        case .color: return "Colors"
        }
    }

    var singular: String {
        switch self {
        case .text: return "Text"
        case .image: return "Image"
        case .file: return "File"
        case .link: return "Link"
        case .email: return "Email"
        case .color: return "Color"
        }
    }

    var symbol: String {
        switch self {
        case .text: return "text.alignleft"
        case .image: return "photo"
        case .file: return "doc"
        case .link: return "link"
        case .email: return "envelope"
        case .color: return "paintpalette"
        }
    }

    /// Kinds whose payload is plain text and can be synced to the phone.
    var isTextual: Bool { self != .image && self != .file }
}

struct ClipItem: Codable, Identifiable, Equatable {
    var id = UUID()
    var kind: ClipKind
    /// Plain text. For files: newline-separated paths. For images: empty.
    var text: String
    var imageFile: String?
    var imageWidth: Int?
    var imageHeight: Int?
    var ocrText: String?
    var rtf: Data?
    var html: Data?
    var sourceApp: String?
    var sourceBundleID: String?
    /// Set when the entry arrived from a paired phone.
    var deviceName: String?
    var firstCopied = Date()
    var lastCopied = Date()
    var copyCount = 1
    var pinned = false
    var hash: String

    var filePaths: [String] {
        kind == .file ? text.split(separator: "\n").map(String.init) : []
    }

    var title: String {
        switch kind {
        case .image:
            if let w = imageWidth, let h = imageHeight { return "Image (\(w)×\(h))" }
            return "Image"
        case .file:
            let paths = filePaths
            if paths.count == 1 { return (paths[0] as NSString).lastPathComponent }
            return "\(paths.count) files"
        default:
            let line = text.split(whereSeparator: \.isNewline)
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .first { !$0.isEmpty } ?? ""
            return String(line.prefix(200))
        }
    }

    func matches(_ query: String) -> Bool {
        [text, ocrText ?? "", sourceApp ?? "", deviceName ?? ""].contains {
            $0.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) != nil
        }
    }
}

func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

enum Classifier {
    private static let email = try! NSRegularExpression(
        pattern: "^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$", options: .caseInsensitive)
    private static let link = try! NSRegularExpression(
        pattern: "^(https?://|www\\.)\\S+$", options: .caseInsensitive)
    private static let hex = try! NSRegularExpression(
        pattern: "^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$", options: .caseInsensitive)
    private static let rgb = try! NSRegularExpression(
        pattern: "^rgba?\\(\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*(?:,\\s*([\\d.]+)\\s*)?\\)$",
        options: .caseInsensitive)

    private static func match(_ re: NSRegularExpression, _ s: String) -> NSTextCheckingResult? {
        re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s))
    }

    static func kind(for text: String) -> ClipKind {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.count > 2048 { return .text }
        if color(from: t) != nil { return .color }
        if match(email, t) != nil { return .email }
        if match(link, t) != nil { return .link }
        return .text
    }

    static func color(from text: String) -> NSColor? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if match(hex, t) != nil {
            var digits = String(t.dropFirst())
            if digits.count <= 4 { digits = digits.map { "\($0)\($0)" }.joined() }
            if digits.count == 6 { digits += "ff" }
            guard let v = UInt32(digits, radix: 16) else { return nil }
            return NSColor(
                srgbRed: CGFloat((v >> 24) & 0xff) / 255, green: CGFloat((v >> 16) & 0xff) / 255,
                blue: CGFloat((v >> 8) & 0xff) / 255, alpha: CGFloat(v & 0xff) / 255)
        }
        if let m = match(rgb, t) {
            func part(_ i: Int) -> Double? {
                guard let r = Range(m.range(at: i), in: t) else { return nil }
                return Double(t[r])
            }
            guard let r = part(1), let g = part(2), let b = part(3), r <= 255, g <= 255, b <= 255 else { return nil }
            return NSColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: min(part(4) ?? 1, 1))
        }
        return nil
    }
}

enum Paths {
    /// Override for isolated test runs.
    private static let override = ProcessInfo.processInfo.environment["RAYLINK_HOME"].map { URL(fileURLWithPath: $0) }

    /// TLS certificate, private key and the list of paired devices.
    static var identityDir: URL { dataDir.appendingPathComponent("identity") }

    /// Earlier versions kept the identity in `~/.raycast-android`. Move it over once so the
    /// Mac keeps its device ID and already paired phones reconnect without pairing again.
    static func migrateLegacyIdentity() {
        guard override == nil else { return }
        let fm = FileManager.default
        let legacy = fm.homeDirectoryForCurrentUser.appendingPathComponent(".raycast-android")
        guard fm.fileExists(atPath: legacy.appendingPathComponent("cert.pem").path),
              !fm.fileExists(atPath: identityDir.path) else { return }
        try? fm.createDirectory(at: dataDir, withIntermediateDirectories: true)
        try? fm.moveItem(at: legacy, to: identityDir)
    }

    static var dataDir: URL {
        override?.appendingPathComponent("data")
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("RayLink")
    }

    static var downloadsDir: URL {
        override?.appendingPathComponent("downloads")
            ?? FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    }
}

enum Settings {
    private static let d = UserDefaults.standard

    static var autoSync: Bool {
        get { d.object(forKey: "autoSync") as? Bool ?? true }
        set { d.set(newValue, forKey: "autoSync") }
    }

    /// 0 means keep forever.
    static var retentionDays: Int {
        get { d.object(forKey: "retentionDays") as? Int ?? 90 }
        set { d.set(newValue, forKey: "retentionDays") }
    }

    static let retentionOptions: [(String, Int)] = [
        ("1 Day", 1), ("1 Week", 7), ("1 Month", 30), ("3 Months", 90), ("1 Year", 365), ("Unlimited", 0),
    ]
}
