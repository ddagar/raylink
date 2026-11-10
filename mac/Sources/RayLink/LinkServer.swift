import Foundation
import Network
import UniformTypeIdentifiers

struct PeerInfo: Identifiable, Equatable {
    let id: UUID
    let deviceId: String
    let name: String
    let address: String
}

/// WebSocket/TLS server the Android app connects to. Speaks the RayLink JSON protocol
/// (see android/.../Protocol.kt). Everything runs on the main queue.
final class LinkServer: ObservableObject {
    static let port: UInt16 = 18734
    static let chunkSize = 64 * 1024
    private static let maxClipboardBytes = 5 * 1024 * 1024
    private static let maxFileBytes: Int64 = 8 * 1024 * 1024 * 1024
    private static let maxIncomingPerPeer = 16

    @Published private(set) var connected: [PeerInfo] = []
    @Published private(set) var pending: [PeerInfo] = []
    @Published private(set) var status = "Starting…"

    /// (text, device name, apply to the Mac clipboard)
    var onClipboard: ((String, String, Bool) -> Void)?
    var onFileReceived: ((URL, String) -> Void)?
    var onPairRequest: ((PeerInfo) -> Void)?
    /// Text to hand to a device when it connects or asks for the clipboard.
    var clipboardProvider: (() -> String?)?

    let devices: DeviceStore
    private let identity: Identity
    private let localName: String
    private var listener: NWListener?
    private var peers: [UUID: Peer] = [:]
    private var outgoing: [String: OutgoingFile] = [:]
    private var pingTimer: Timer?

    private final class Peer {
        let key = UUID()
        let conn: NWConnection
        let address: String
        var deviceId = ""
        var name = ""
        var paired = false
        var rejected = false
        var incoming: [String: IncomingFile] = [:]

        init(conn: NWConnection) {
            self.conn = conn
            if case let .hostPort(host, _) = conn.endpoint {
                address = "\(host)".split(separator: "%").first.map(String.init) ?? "\(host)"
            } else {
                address = "unknown"
            }
        }

        var info: PeerInfo { PeerInfo(id: key, deviceId: deviceId, name: name, address: address) }
    }

    private final class IncomingFile {
        let name: String
        let declared: Int64
        let partURL: URL
        let handle: FileHandle
        var received: Int64 = 0

        init(name: String, declared: Int64, partURL: URL, handle: FileHandle) {
            self.name = name
            self.declared = declared
            self.partURL = partURL
            self.handle = handle
        }
    }

    private final class OutgoingFile {
        let url: URL
        let size: Int64
        let peerKey: UUID
        var handle: FileHandle?
        var offset: Int64 = 0

        init(url: URL, size: Int64, peerKey: UUID) {
            self.url = url
            self.size = size
            self.peerKey = peerKey
        }
    }

    init(identity: Identity, devices: DeviceStore) {
        self.identity = identity
        self.devices = devices
        localName = Host.current().localizedName ?? ProcessInfo.processInfo.hostName
    }

    // MARK: - Lifecycle

    func start() {
        let tls = NWProtocolTLS.Options()
        if let secIdentity = sec_identity_create(identity.secIdentity) {
            sec_protocol_options_set_local_identity(tls.securityProtocolOptions, secIdentity)
        }
        sec_protocol_options_set_min_tls_protocol_version(tls.securityProtocolOptions, .TLSv12)

        let tcp = NWProtocolTCP.Options()
        tcp.enableKeepalive = true
        tcp.keepaliveIdle = 30

        let params = NWParameters(tls: tls, tcp: tcp)
        params.allowLocalEndpointReuse = true
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        ws.maximumMessageSize = 16 * 1024 * 1024
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)

        do {
            let listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: Self.port)!)
            var txt = NWTXTRecord()
            txt["deviceId"] = identity.deviceId
            txt["deviceName"] = localName
            txt["protocolVersion"] = "1"
            listener.service = NWListener.Service(name: "RayLink-\(localName)", type: "_raylink._tcp", txtRecord: txt)
            listener.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
            listener.stateUpdateHandler = { [weak self] state in self?.listenerChanged(state) }
            listener.start(queue: .main)
            self.listener = listener
        } catch {
            status = "Could not start: \(error.localizedDescription)"
            retryLater()
        }

        if pingTimer == nil {
            let timer = Timer(timeInterval: 30, repeats: true) { [weak self] _ in
                self?.peers.values.forEach { self?.send($0, "ping") }
            }
            RunLoop.main.add(timer, forMode: .common)
            pingTimer = timer
        }
    }

    private func listenerChanged(_ state: NWListener.State) {
        switch state {
        case .ready:
            status = "Listening on port \(Self.port)"
        case .failed(let error):
            status = "Port \(Self.port) unavailable (\(error.localizedDescription))"
            listener?.cancel()
            listener = nil
            retryLater()
        case .waiting(let error):
            status = "Waiting for network (\(error.localizedDescription))"
        default:
            break
        }
    }

    private func retryLater() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self, self.listener == nil else { return }
            self.start()
        }
    }

    // MARK: - Connections

    private func accept(_ conn: NWConnection) {
        let peer = Peer(conn: conn)
        peers[peer.key] = peer
        conn.stateUpdateHandler = { [weak self, weak peer] state in
            guard let self, let peer else { return }
            switch state {
            case .ready: self.receive(peer)
            case .failed, .cancelled: self.drop(peer)
            default: break
            }
        }
        conn.start(queue: .main)
    }

    private func receive(_ peer: Peer) {
        peer.conn.receiveMessage { [weak self, weak peer] data, context, _, error in
            guard let self, let peer, self.peers[peer.key] != nil else { return }
            let meta = context?.protocolMetadata(definition: NWProtocolWebSocket.definition)
                as? NWProtocolWebSocket.Metadata
            if let meta, meta.opcode == .close {
                peer.conn.cancel()
                return
            }
            if let data, let meta, meta.opcode == .text {
                self.handle(data, from: peer)
            }
            if error != nil || (data == nil && meta == nil) {
                peer.conn.cancel()
                return
            }
            self.receive(peer)
        }
    }

    private func drop(_ peer: Peer) {
        guard peers.removeValue(forKey: peer.key) != nil else { return }
        for file in peer.incoming.values {
            try? file.handle.close()
            try? FileManager.default.removeItem(at: file.partURL)
        }
        peer.incoming.removeAll()
        for (id, file) in outgoing where file.peerKey == peer.key {
            try? file.handle?.close()
            outgoing[id] = nil
        }
        publish()
    }

    private func publish() {
        connected = peers.values.filter(\.paired).map(\.info).sorted { $0.name < $1.name }
        pending = peers.values
            .filter { !$0.paired && !$0.rejected && !$0.deviceId.isEmpty }
            .map(\.info)
    }

    private func send(
        _ peer: Peer, _ type: String, _ body: [String: Any] = [:], completion: ((Bool) -> Void)? = nil
    ) {
        let message: [String: Any] = [
            "id": UUID().uuidString.lowercased(),
            "type": type,
            "timestamp": Int(Date().timeIntervalSince1970 * 1000),
            "body": body,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: message) else {
            completion?(false)
            return
        }
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "message", metadata: [meta])
        peer.conn.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { error in
            completion?(error == nil)
        })
    }

    // MARK: - Incoming messages

    /// Android sends every body value as a string; other clients may send native types.
    private func string(_ value: Any?) -> String? {
        if let s = value as? String { return s }
        if let n = value as? NSNumber { return n.stringValue }
        return nil
    }

    private func bool(_ value: Any?) -> Bool {
        if let s = value as? String { return s == "true" }
        return (value as? NSNumber)?.boolValue ?? false
    }

    private func handle(_ data: Data, from peer: Peer) {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }
        let body = json["body"] as? [String: Any] ?? [:]

        switch type {
        case "pair.request":
            handlePairRequest(body, from: peer)
        case "ping":
            send(peer, "pong")
        case "pong":
            break
        default:
            // Everything else needs a paired device. A client cannot pair itself:
            // `pair.accept` is only ever sent by this side.
            guard peer.paired else { return }
            switch type {
            case "clipboard.update", "clipboard.connect":
                guard let content = string(body["content"]), !content.isEmpty,
                      content.utf8.count <= Self.maxClipboardBytes else { return }
                // `clipboard.connect` is whatever was on the phone when it connected. Record it,
                // but do not replace what the user is working with on the Mac.
                onClipboard?(content, peer.name, type == "clipboard.update")
            case "clipboard.request":
                if let text = clipboardProvider?(), !text.isEmpty {
                    send(peer, "clipboard.update", ["content": text, "contentType": "text"])
                }
            case "file.offer":
                handleFileOffer(body, from: peer)
            case "file.chunk":
                handleFileChunk(body, from: peer)
            case "file.accept":
                if let id = string(body["transferId"]) { startSending(id, to: peer) }
            case "file.reject":
                if let id = string(body["transferId"]), outgoing[id]?.peerKey == peer.key { outgoing[id] = nil }
            default:
                break
            }
        }
    }

    // MARK: - Pairing

    private func handlePairRequest(_ body: [String: Any], from peer: Peer) {
        guard let deviceId = string(body["deviceId"]),
              deviceId.range(of: "^[A-Za-z0-9_-]{8,64}$", options: .regularExpression) != nil else { return }
        let name = String((string(body["deviceName"]) ?? "Android").prefix(64))
        peer.deviceId = deviceId
        peer.name = name.isEmpty ? "Android" : name
        peer.rejected = false

        // A reconnect replaces any older connection from the same device.
        for other in peers.values where other.key != peer.key && other.deviceId == deviceId {
            other.conn.cancel()
            drop(other)
        }

        if devices.device(deviceId) != nil {
            devices.seen(deviceId, name: peer.name)
            completePairing(peer)
        } else {
            publish()
            onPairRequest?(peer.info)
        }
    }

    private func completePairing(_ peer: Peer) {
        peer.paired = true
        send(peer, "pair.accept", [
            "deviceName": localName, "deviceId": identity.deviceId, "certificate": identity.certPEM,
        ])
        if Settings.autoSync, let text = clipboardProvider?(), !text.isEmpty,
           text.utf8.count <= Self.maxClipboardBytes {
            send(peer, "clipboard.connect", ["content": text, "contentType": "text"])
        }
        publish()
    }

    func acceptPairing(_ key: UUID) {
        guard let peer = peers[key], !peer.paired, !peer.deviceId.isEmpty else { return }
        devices.add(id: peer.deviceId, name: peer.name)
        completePairing(peer)
    }

    func rejectPairing(_ key: UUID) {
        guard let peer = peers[key], !peer.paired else { return }
        peer.rejected = true
        send(peer, "pair.reject")
        publish()
    }

    func unpair(_ deviceId: String) {
        devices.remove(deviceId)
        for peer in peers.values where peer.deviceId == deviceId {
            peer.conn.cancel()
            drop(peer)
        }
        publish()
    }

    // MARK: - Clipboard

    /// Sends text to every connected paired device. Returns how many received it.
    @discardableResult
    func broadcastClipboard(_ text: String) -> Int {
        guard text.utf8.count <= Self.maxClipboardBytes else { return 0 }
        let targets = peers.values.filter(\.paired)
        targets.forEach { send($0, "clipboard.update", ["content": text, "contentType": "text"]) }
        return targets.count
    }

    /// Asks the phone for its clipboard; the answer arrives as a normal `clipboard.update`.
    @discardableResult
    func requestClipboard() -> Bool {
        guard let peer = peers.values.first(where: \.paired) else { return false }
        send(peer, "clipboard.request")
        return true
    }

    // MARK: - Receiving files

    static func sanitize(fileName: String) -> String {
        var name = (fileName.replacingOccurrences(of: "\\", with: "/") as NSString).lastPathComponent
        name = name.components(separatedBy: CharacterSet(charactersIn: "/:\0").union(.controlCharacters)).joined(separator: "_")
        while name.hasPrefix(".") { name.removeFirst() }
        name = String(name.prefix(200)).trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? "file" : name
    }

    private func handleFileOffer(_ body: [String: Any], from peer: Peer) {
        guard let id = string(body["transferId"]), !id.isEmpty, id.count <= 64 else { return }
        let declared = Int64(string(body["fileSize"]) ?? "") ?? 0
        guard peer.incoming.count < Self.maxIncomingPerPeer, peer.incoming[id] == nil,
              declared >= 0, declared <= Self.maxFileBytes else {
            send(peer, "file.reject", ["transferId": id])
            return
        }
        let fm = FileManager.default
        let dir = Paths.downloadsDir
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let part = dir.appendingPathComponent(".raylink-\(UUID().uuidString).part")
        guard fm.createFile(atPath: part.path, contents: nil),
              let handle = try? FileHandle(forWritingTo: part) else {
            send(peer, "file.reject", ["transferId": id])
            return
        }
        peer.incoming[id] = IncomingFile(
            name: Self.sanitize(fileName: string(body["fileName"]) ?? ""),
            declared: declared, partURL: part, handle: handle)
        send(peer, "file.accept", ["transferId": id])
    }

    private func handleFileChunk(_ body: [String: Any], from peer: Peer) {
        guard let id = string(body["transferId"]), let file = peer.incoming[id] else { return }
        let chunk = Data(base64Encoded: string(body["data"]) ?? "", options: .ignoreUnknownCharacters) ?? Data()
        file.received += Int64(chunk.count)
        // The sender declares the size up front; refuse to write past it.
        let limit = file.declared > 0 ? file.declared : Self.maxFileBytes
        let failed = file.received > limit || (try? file.handle.write(contentsOf: chunk)) == nil
        if failed {
            try? file.handle.close()
            try? FileManager.default.removeItem(at: file.partURL)
            peer.incoming[id] = nil
            return
        }
        guard bool(body["isLast"]) else { return }

        try? file.handle.close()
        peer.incoming[id] = nil
        let destination = Self.uniqueURL(in: Paths.downloadsDir, name: file.name)
        do {
            try FileManager.default.moveItem(at: file.partURL, to: destination)
            onFileReceived?(destination, peer.name)
        } catch {
            try? FileManager.default.removeItem(at: file.partURL)
        }
    }

    private static func uniqueURL(in dir: URL, name: String) -> URL {
        var url = dir.appendingPathComponent(name)
        let ext = (name as NSString).pathExtension
        let base = (name as NSString).deletingPathExtension
        var counter = 1
        while FileManager.default.fileExists(atPath: url.path) {
            url = dir.appendingPathComponent(ext.isEmpty ? "\(base) (\(counter))" : "\(base) (\(counter)).\(ext)")
            counter += 1
        }
        return url
    }

    // MARK: - Sending files

    /// Offers a file to the first connected device. Returns false when nothing is connected
    /// or the file cannot be read.
    @discardableResult
    func sendFile(_ url: URL) -> Bool {
        guard let peer = peers.values.first(where: \.paired),
              let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
              values.isRegularFile == true, let size = values.fileSize else { return false }
        let id = UUID().uuidString.lowercased()
        outgoing[id] = OutgoingFile(url: url, size: Int64(size), peerKey: peer.key)
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        send(peer, "file.offer", [
            "fileName": url.lastPathComponent, "fileSize": size, "mimeType": mime, "transferId": id,
        ])
        return true
    }

    private func startSending(_ id: String, to peer: Peer) {
        guard let file = outgoing[id], file.peerKey == peer.key, file.handle == nil else { return }
        guard let handle = try? FileHandle(forReadingFrom: file.url) else {
            outgoing[id] = nil
            return
        }
        file.handle = handle
        pump(id, peer)
    }

    /// Sends one chunk and waits for the socket to take it before reading the next,
    /// so large files are never buffered whole.
    private func pump(_ id: String, _ peer: Peer) {
        guard let file = outgoing[id], let handle = file.handle else { return }
        let chunk = (try? handle.read(upToCount: Self.chunkSize)) ?? Data()
        let offset = file.offset
        file.offset += Int64(chunk.count)
        let isLast = chunk.isEmpty || file.offset >= file.size
        send(peer, "file.chunk", [
            "transferId": id, "data": chunk.base64EncodedString(), "offset": offset, "isLast": isLast,
        ]) { [weak self, weak peer] ok in
            guard let self, let peer else { return }
            if ok && !isLast {
                self.pump(id, peer)
            } else {
                try? handle.close()
                self.outgoing[id] = nil
            }
        }
    }
}
