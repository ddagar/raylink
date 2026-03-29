import { hostname } from "node:os";
import { loadOrCreateCertificate } from "./certificate.js";
import { DeviceStore } from "./device-store.js";
import { DiscoveryService } from "./discovery.js";
import { ClipboardMonitor } from "./clipboard.js";
import { FileTransferManager } from "./file-transfer.js";
import { PairingManager } from "./pairing.js";
import { WebSocketManager } from "./websocket.js";
import { ApiServer } from "./server.js";
import { WEBSOCKET_PORT, DAEMON_PORT, createMessage } from "./protocol.js";

async function main() {
  console.log("[daemon] Starting RayLink daemon...");

  // 1. Load or generate TLS certificate
  const certInfo = await loadOrCreateCertificate();
  console.log(`[daemon] Certificate fingerprint: ${certInfo.fingerprint.substring(0, 16)}...`);

  // 2. Initialize device store
  const deviceStore = new DeviceStore();
  await deviceStore.load();
  console.log(`[daemon] Loaded ${deviceStore.getAllDevices().length} paired device(s)`);

  // 3. Generate device identity
  const deviceId = certInfo.fingerprint.substring(0, 32);
  const deviceName = hostname();

  // 4. Initialize components
  const clipboardMonitor = new ClipboardMonitor();
  const fileTransferManager = new FileTransferManager();
  const pairingManager = new PairingManager(
    certInfo.cert,
    deviceId,
    deviceName,
    deviceStore
  );

  // 5. Initialize WebSocket server
  const wsManager = new WebSocketManager(
    certInfo,
    pairingManager,
    clipboardMonitor,
    fileTransferManager,
    deviceStore
  );

  // 6. Set up clipboard sync: Mac clipboard change → send to all connected devices
  clipboardMonitor.onClipboardChange((content) => {
    console.log(`[daemon] Mac clipboard changed, broadcasting to devices`);
    wsManager.broadcast(
      createMessage("clipboard.update", { content, contentType: "text" })
    );
    clipboardMonitor.addToHistory({
      content,
      contentType: "text",
      source: "mac",
      timestamp: Date.now(),
    });
  });

  // 7. Set up event logging
  wsManager.setOnDeviceConnected((device) => {
    console.log(`[daemon] Device connected: ${device.name} (${device.id})`);
  });

  wsManager.setOnDeviceDisconnected((deviceId) => {
    console.log(`[daemon] Device disconnected: ${deviceId}`);
  });

  pairingManager.setOnPairingRequest((pending) => {
    console.log(`[daemon] Pairing request from ${pending.deviceName}`);
    console.log(`[daemon] Verification code: ${pending.verificationCode}`);
    console.log(`[daemon] Accept via API: POST http://127.0.0.1:${DAEMON_PORT}/devices/${pending.deviceId}/pair`);
  });

  // 8. Initialize HTTP API server
  const apiServer = new ApiServer(
    deviceStore,
    clipboardMonitor,
    fileTransferManager,
    pairingManager,
    wsManager
  );

  // 9. Start everything
  wsManager.start(WEBSOCKET_PORT);
  apiServer.start(DAEMON_PORT);
  clipboardMonitor.start();

  // 10. Start mDNS discovery
  const discovery = new DiscoveryService(deviceId);
  discovery.advertise(WEBSOCKET_PORT);

  console.log(`[daemon] RayLink daemon started`);
  console.log(`[daemon] Device: ${deviceName} (${deviceId.substring(0, 8)}...)`);
  console.log(`[daemon] WebSocket: wss://0.0.0.0:${WEBSOCKET_PORT}`);
  console.log(`[daemon] API: http://127.0.0.1:${DAEMON_PORT}`);
  console.log(`[daemon] mDNS: _raylink._tcp`);

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[daemon] Shutting down...");
    clipboardMonitor.stop();
    wsManager.stop();
    apiServer.stop();
    discovery.destroy();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[daemon] Fatal error:", err);
  process.exit(1);
});
