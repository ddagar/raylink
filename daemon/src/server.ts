import express from "express";
import { type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { DAEMON_PORT, createMessage } from "./protocol.js";
import { DeviceStore } from "./device-store.js";
import { ClipboardMonitor } from "./clipboard.js";
import { FileTransferManager } from "./file-transfer.js";
import { PairingManager } from "./pairing.js";
import { WebSocketManager } from "./websocket.js";

const VERSION = "0.1.0";

export class ApiServer {
  private app: ReturnType<typeof express>;
  private server: Server | null = null;
  private startTime: number = Date.now();

  private deviceStore: DeviceStore;
  private clipboardMonitor: ClipboardMonitor;
  private fileTransferManager: FileTransferManager;
  private pairingManager: PairingManager;
  private wsManager: WebSocketManager;

  constructor(
    deviceStore: DeviceStore,
    clipboardMonitor: ClipboardMonitor,
    fileTransferManager: FileTransferManager,
    pairingManager: PairingManager,
    wsManager: WebSocketManager
  ) {
    this.deviceStore = deviceStore;
    this.clipboardMonitor = clipboardMonitor;
    this.fileTransferManager = fileTransferManager;
    this.pairingManager = pairingManager;
    this.wsManager = wsManager;

    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health / status
    this.app.get("/status", (_req, res) => {
      const connected = this.wsManager.getConnectedDevices();
      const allDevices = this.deviceStore.getAllDevices();
      res.json({
        running: true,
        version: VERSION,
        uptime: Date.now() - this.startTime,
        deviceCount: allDevices.length,
        connectedCount: connected.length,
      });
    });

    // List devices (paired + connected status)
    this.app.get("/devices", (_req, res) => {
      const stored = this.deviceStore.getAllDevices();
      const connected = this.wsManager.getConnectedDevices();
      const connectedIds = new Set(connected.map((d) => d.id));

      const devices = stored.map((d) => ({
        id: d.id,
        name: d.name,
        paired: true,
        connected: connectedIds.has(d.id),
        lastSeen: d.lastSeen,
      }));

      res.json(devices);
    });

    // Accept incoming pairing
    this.app.post("/devices/:id/pair", async (req, res) => {
      const pending = this.pairingManager.getPending();
      if (!pending || pending.deviceId !== req.params.id) {
        res.status(404).json({ error: "No pending pairing for this device" });
        return;
      }

      await this.pairingManager.acceptPairing();
      res.json({ success: true, verificationCode: pending.verificationCode });
    });

    // Get pending pairing info
    this.app.get("/pairing", (_req, res) => {
      const pending = this.pairingManager.getPending();
      if (!pending) {
        res.json({ state: "idle", pending: null });
        return;
      }
      res.json({
        state: this.pairingManager.getState(),
        pending: {
          deviceId: pending.deviceId,
          deviceName: pending.deviceName,
          verificationCode: pending.verificationCode,
          timestamp: pending.timestamp,
        },
      });
    });

    // Reject incoming pairing
    this.app.post("/pairing/reject", (_req, res) => {
      this.pairingManager.rejectPairing();
      res.json({ success: true });
    });

    // Unpair device
    this.app.post("/devices/:id/unpair", async (req, res) => {
      const device = this.deviceStore.getDevice(req.params.id);
      if (!device) {
        res.status(404).json({ error: "Device not found" });
        return;
      }

      await this.pairingManager.unpairDevice(req.params.id);
      res.json({ success: true });
    });

    // Send clipboard to device
    this.app.post("/devices/:id/clipboard/send", (req, res) => {
      const { content } = req.body as { content?: string };
      if (!content) {
        res.status(400).json({ error: "content is required" });
        return;
      }

      const sent = this.wsManager.sendToDevice(
        req.params.id,
        createMessage("clipboard.update", { content, contentType: "text" })
      );

      if (sent) {
        this.clipboardMonitor.addToHistory({
          content,
          contentType: "text",
          source: "mac",
          timestamp: Date.now(),
        });
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Device not connected" });
      }
    });

    // Send clipboard to all connected devices
    this.app.post("/clipboard/send", async (req, res) => {
      let content = (req.body as { content?: string })?.content;

      if (!content) {
        // Read from macOS clipboard
        content = (await this.clipboardMonitor.getClipboard()) || undefined;
      }

      if (!content) {
        res.status(400).json({ error: "No clipboard content" });
        return;
      }

      this.wsManager.broadcast(
        createMessage("clipboard.update", { content, contentType: "text" })
      );

      this.clipboardMonitor.addToHistory({
        content,
        contentType: "text",
        source: "mac",
        timestamp: Date.now(),
      });

      res.json({ success: true });
    });

    // Get latest clipboard from device
    this.app.get("/devices/:id/clipboard/latest", (_req, res) => {
      const latest = this.clipboardMonitor.getLatestFromDevice();
      if (latest) {
        res.json(latest);
      } else {
        res.status(404).json({ error: "No clipboard data from device" });
      }
    });

    // Request clipboard from device
    this.app.post("/clipboard/pull", (req, res) => {
      const connected = this.wsManager.getConnectedDevices();
      if (connected.length === 0) {
        res.status(404).json({ error: "No devices connected" });
        return;
      }
      // Request from first connected device
      this.wsManager.sendToDevice(
        connected[0].id,
        createMessage("clipboard.request")
      );
      res.json({ success: true, message: "Clipboard requested" });
    });

    // Clipboard history
    this.app.get("/clipboard/history", (_req, res) => {
      res.json(this.clipboardMonitor.getHistory());
    });

    // Send file to device
    this.app.post("/devices/:id/file/send", async (req, res) => {
      const { filePath } = req.body as { filePath?: string };
      if (!filePath) {
        res.status(400).json({ error: "filePath is required" });
        return;
      }

      try {
        // Set up message sender to target the specific device
        this.fileTransferManager.setMessageSender((msg) => {
          this.wsManager.sendToDevice(req.params.id, msg);
        });

        const transfer = await this.fileTransferManager.initiateTransfer(filePath);
        res.json({ success: true, transferId: transfer.id });
      } catch (err) {
        res.status(500).json({ error: `Failed to send file: ${err}` });
      }
    });

    // List transfers
    this.app.get("/transfers", (_req, res) => {
      res.json(this.fileTransferManager.getAllTransfers());
    });
  }

  start(port: number = DAEMON_PORT): void {
    this.startTime = Date.now();
    this.server = this.app.listen(port, "127.0.0.1", () => {
      console.log(`[api] HTTP API listening on http://127.0.0.1:${port}`);
    });
  }

  stop(): void {
    this.server?.close();
    console.log("[api] Server stopped");
  }
}
