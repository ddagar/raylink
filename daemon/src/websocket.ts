import { createServer, type Server as HttpsServer } from "node:https";
import { WebSocketServer, WebSocket } from "ws";
import { type CertificateInfo } from "./certificate.js";
import {
  parseMessage,
  serializeMessage,
  createMessage,
  type Message,
  WEBSOCKET_PORT,
} from "./protocol.js";
import { PairingManager } from "./pairing.js";
import { ClipboardMonitor, type ClipboardEntry } from "./clipboard.js";
import { FileTransferManager } from "./file-transfer.js";
import { DeviceStore } from "./device-store.js";

export interface ConnectedDevice {
  id: string;
  name: string;
  ws: WebSocket;
  paired: boolean;
}

export class WebSocketManager {
  private httpsServer: HttpsServer | null = null;
  private wss: WebSocketServer | null = null;
  private connections: Map<WebSocket, ConnectedDevice> = new Map();

  private certInfo: CertificateInfo;
  private pairingManager: PairingManager;
  private clipboardMonitor: ClipboardMonitor;
  private fileTransferManager: FileTransferManager;
  private deviceStore: DeviceStore;

  private onDeviceConnected: ((device: ConnectedDevice) => void) | null = null;
  private onDeviceDisconnected: ((deviceId: string) => void) | null = null;

  constructor(
    certInfo: CertificateInfo,
    pairingManager: PairingManager,
    clipboardMonitor: ClipboardMonitor,
    fileTransferManager: FileTransferManager,
    deviceStore: DeviceStore
  ) {
    this.certInfo = certInfo;
    this.pairingManager = pairingManager;
    this.clipboardMonitor = clipboardMonitor;
    this.fileTransferManager = fileTransferManager;
    this.deviceStore = deviceStore;

    this.setupMessageSenders();
  }

  setOnDeviceConnected(callback: (device: ConnectedDevice) => void): void {
    this.onDeviceConnected = callback;
  }

  setOnDeviceDisconnected(callback: (deviceId: string) => void): void {
    this.onDeviceDisconnected = callback;
  }

  start(port: number = WEBSOCKET_PORT): void {
    this.httpsServer = createServer({
      cert: this.certInfo.cert,
      key: this.certInfo.key,
      // Accept all client certificates (we verify via our own pairing)
      requestCert: false,
      rejectUnauthorized: false,
    });

    this.wss = new WebSocketServer({ server: this.httpsServer });

    this.wss.on("connection", (ws, req) => {
      const addr = req.socket.remoteAddress || "unknown";
      console.log(`[ws] New connection from ${addr}`);

      const device: ConnectedDevice = {
        id: "",
        name: "",
        ws,
        paired: false,
      };
      this.connections.set(ws, device);

      ws.on("message", (data) => {
        const raw = data.toString();
        const msg = parseMessage(raw);
        if (!msg) {
          console.warn("[ws] Invalid message received");
          return;
        }
        this.handleMessage(ws, device, msg);
      });

      ws.on("close", () => {
        const dev = this.connections.get(ws);
        if (dev?.id) {
          console.log(`[ws] Device disconnected: ${dev.name} (${dev.id})`);
          this.onDeviceDisconnected?.(dev.id);
        }
        this.connections.delete(ws);
      });

      ws.on("error", (err) => {
        console.error("[ws] Connection error:", err.message);
      });

      // Send ping every 30s
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(serializeMessage(createMessage("ping")));
        } else {
          clearInterval(pingInterval);
        }
      }, 30_000);
    });

    this.httpsServer.listen(port, () => {
      console.log(`[ws] WebSocket server listening on port ${port}`);
    });
  }

  stop(): void {
    for (const [ws] of this.connections) {
      ws.close();
    }
    this.connections.clear();
    this.wss?.close();
    this.httpsServer?.close();
    console.log("[ws] Server stopped");
  }

  getConnectedDevices(): ConnectedDevice[] {
    return Array.from(this.connections.values()).filter((d) => d.paired);
  }

  sendToDevice(deviceId: string, msg: Message): boolean {
    for (const [, device] of this.connections) {
      if (device.id === deviceId && device.ws.readyState === WebSocket.OPEN) {
        device.ws.send(serializeMessage(msg));
        return true;
      }
    }
    return false;
  }

  broadcast(msg: Message): void {
    const serialized = serializeMessage(msg);
    for (const [, device] of this.connections) {
      if (device.paired && device.ws.readyState === WebSocket.OPEN) {
        device.ws.send(serialized);
      }
    }
  }

  private setupMessageSenders(): void {
    // The pairing manager and file transfer manager need to send messages
    // through the current active connection. We use a per-connection sender
    // that gets set up in handleMessage when we know which connection to use.
  }

  private handleMessage(ws: WebSocket, device: ConnectedDevice, msg: Message): void {
    const sendToThis = (reply: Message) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(serializeMessage(reply));
      }
    };

    switch (msg.type) {
      case "pair.request": {
        const body = msg.body as { deviceName: string; deviceId: string; certificate: string };
        device.id = body.deviceId;
        device.name = body.deviceName;

        // Set up message sender for this pairing session
        this.pairingManager.setMessageSender(sendToThis);
        this.pairingManager.setOnPairingComplete((storedDevice) => {
          device.paired = true;
          device.id = storedDevice.id;
          device.name = storedDevice.name;
          this.onDeviceConnected?.(device);
        });

        this.pairingManager.handlePairRequest(body);
        break;
      }

      case "pair.accept": {
        const body = msg.body as { deviceName: string; deviceId: string; certificate: string };
        device.id = body.deviceId;
        device.name = body.deviceName;
        device.paired = true;

        this.pairingManager.setMessageSender(sendToThis);
        this.pairingManager.handlePairAccept(body);
        this.onDeviceConnected?.(device);
        break;
      }

      case "pair.reject": {
        this.pairingManager.handlePairReject();
        break;
      }

      case "clipboard.update": {
        const body = msg.body as { content: string; contentType: "text" | "html" };
        if (!device.paired) return;

        console.log(`[ws] Clipboard from ${device.name}: ${body.content.substring(0, 50)}...`);

        // Set macOS clipboard
        this.clipboardMonitor.setClipboard(body.content);

        // Add to history
        this.clipboardMonitor.addToHistory({
          content: body.content,
          contentType: body.contentType,
          source: "android",
          deviceName: device.name,
          timestamp: Date.now(),
        });
        break;
      }

      case "clipboard.request": {
        if (!device.paired) return;
        this.clipboardMonitor.getClipboard().then((content) => {
          if (content) {
            sendToThis(
              createMessage("clipboard.update", {
                content,
                contentType: "text",
              })
            );
          }
        });
        break;
      }

      case "file.offer": {
        if (!device.paired) return;
        const body = msg.body as {
          fileName: string;
          fileSize: number;
          mimeType: string;
          transferId: string;
        };
        this.fileTransferManager.setMessageSender(sendToThis);
        this.fileTransferManager.handleFileOffer(body);
        console.log(`[ws] Incoming file: ${body.fileName} (${body.fileSize} bytes)`);
        break;
      }

      case "file.accept": {
        if (!device.paired) return;
        const body = msg.body as { transferId: string };
        this.fileTransferManager.setMessageSender(sendToThis);
        this.fileTransferManager.handleFileAccept(body.transferId);
        break;
      }

      case "file.reject": {
        if (!device.paired) return;
        const body = msg.body as { transferId: string };
        this.fileTransferManager.handleFileReject(body.transferId);
        break;
      }

      case "file.chunk": {
        if (!device.paired) return;
        const body = msg.body as {
          transferId: string;
          data: string;
          offset: number;
          isLast: boolean;
        };
        this.fileTransferManager.handleFileChunk(body);
        break;
      }

      case "ping": {
        sendToThis(createMessage("pong"));
        break;
      }

      case "pong": {
        if (device.id) {
          this.deviceStore.updateLastSeen(device.id);
        }
        break;
      }
    }
  }
}
