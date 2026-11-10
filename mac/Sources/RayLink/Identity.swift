import Foundation
import Security

/// This Mac's TLS identity: a self-signed certificate created on first launch.
struct Identity {
    let certPEM: String
    let secIdentity: SecIdentity
    let deviceId: String

    enum LoadError: LocalizedError {
        case openssl(String)
        case importFailed(OSStatus)

        var errorDescription: String? {
            switch self {
            case .openssl(let message): return "openssl failed: \(message)"
            case .importFailed(let status): return "Could not import TLS identity (status \(status))"
            }
        }
    }

    static func load() throws -> Identity {
        Paths.migrateLegacyIdentity()
        let fm = FileManager.default
        let dir = Paths.identityDir
        let cert = dir.appendingPathComponent("cert.pem")
        let key = dir.appendingPathComponent("key.pem")
        try fm.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])

        if !fm.fileExists(atPath: cert.path) || !fm.fileExists(atPath: key.path) {
            try openssl([
                "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3650",
                "-keyout", key.path, "-out", cert.path, "-subj", "/CN=RayLink/O=RayLink",
            ])
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: key.path)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: cert.path)
        }

        // Network.framework needs a SecIdentity; PKCS#12 is the only import path that yields one.
        let p12 = fm.temporaryDirectory.appendingPathComponent("raylink-\(UUID().uuidString).p12")
        defer { try? fm.removeItem(at: p12) }
        let passphrase = UUID().uuidString
        try openssl([
            "pkcs12", "-export", "-inkey", key.path, "-in", cert.path,
            "-out", p12.path, "-name", "RayLink", "-passout", "pass:\(passphrase)",
        ])

        var imported: CFArray?
        let options = [
            kSecImportExportPassphrase as String: passphrase,
            kSecImportToMemoryOnly as String: true,
        ] as CFDictionary
        let status = SecPKCS12Import(try Data(contentsOf: p12) as CFData, options, &imported)
        guard status == errSecSuccess,
              let first = (imported as? [[String: Any]])?.first,
              let value = first[kSecImportItemIdentity as String] else {
            throw LoadError.importFailed(status)
        }

        let pemData = try Data(contentsOf: cert)
        return Identity(
            certPEM: String(decoding: pemData, as: UTF8.self),
            secIdentity: value as! SecIdentity,
            // The device ID phones know this Mac by: first 32 hex chars of SHA-256 over the PEM text.
            deviceId: String(sha256Hex(pemData).prefix(32)))
    }

    private static func openssl(_ args: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/openssl")
        process.arguments = args
        let stderr = Pipe()
        process.standardError = stderr
        process.standardOutput = Pipe()
        try process.run()
        let message = String(decoding: stderr.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        process.waitUntilExit()
        if process.terminationStatus != 0 { throw LoadError.openssl(message) }
    }
}

struct StoredDevice: Codable {
    var id: String
    var name: String
    var certificateFingerprint: String
    var certificatePem: String
    var pairedAt: Double
    var lastSeen: Double
}

/// Paired devices, persisted as `devices.json`.
final class DeviceStore {
    private struct File: Codable { var devices: [String: StoredDevice] }

    private var devices: [String: StoredDevice] = [:]
    private let url = Paths.identityDir.appendingPathComponent("devices.json")

    init() {
        if let data = try? Data(contentsOf: url), let file = try? JSONDecoder().decode(File.self, from: data) {
            devices = file.devices
        }
    }

    var all: [StoredDevice] { devices.values.sorted { $0.name < $1.name } }

    func device(_ id: String) -> StoredDevice? { devices[id] }

    func add(id: String, name: String) {
        let now = Date().timeIntervalSince1970 * 1000
        devices[id] = StoredDevice(
            id: id, name: name, certificateFingerprint: "", certificatePem: "", pairedAt: now, lastSeen: now)
        save()
    }

    func remove(_ id: String) {
        devices[id] = nil
        save()
    }

    func seen(_ id: String, name: String? = nil) {
        guard var device = devices[id] else { return }
        device.lastSeen = Date().timeIntervalSince1970 * 1000
        if let name, !name.isEmpty { device.name = name }
        devices[id] = device
        save()
    }

    private func save() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(File(devices: devices)) else { return }
        try? data.write(to: url, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
