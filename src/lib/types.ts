// Shared types for the Raycast Android Link extension and daemon

// === Protocol Messages ===

export interface Message {
  id: string;
  type: MessageType;
  timestamp: number;
  body: Record<string, unknown>;
}

export type MessageType =
  | "pair.request"
  | "pair.accept"
  | "pair.reject"
  | "clipboard.update"
  | "clipboard.request"
  | "file.offer"
  | "file.accept"
  | "file.reject"
  | "file.chunk"
  | "ping"
  | "pong";

export interface PairRequestBody {
  deviceName: string;
  deviceId: string;
  certificate: string; // PEM-encoded certificate
}

export interface PairAcceptBody {
  deviceName: string;
  deviceId: string;
  certificate: string;
}

export interface ClipboardUpdateBody {
  content: string;
  contentType: "text" | "html";
}

export interface FileOfferBody {
  fileName: string;
  fileSize: number;
  mimeType: string;
  transferId: string;
}

export interface FileAcceptBody {
  transferId: string;
}

export interface FileRejectBody {
  transferId: string;
}

export interface FileChunkBody {
  transferId: string;
  data: string; // base64
  offset: number;
  isLast: boolean;
}

// === Device Types ===

export interface Device {
  id: string;
  name: string;
  paired: boolean;
  connected: boolean;
  lastSeen: number;
  address?: string;
  port?: number;
  certificateFingerprint?: string;
}

// === Transfer Types ===

export type TransferDirection = "incoming" | "outgoing";
export type TransferStatus = "pending" | "in_progress" | "completed" | "failed" | "rejected";

export interface FileTransfer {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  direction: TransferDirection;
  status: TransferStatus;
  progress: number; // 0-100
  localPath?: string;
  timestamp: number;
}

// === Clipboard Types ===

export type ClipboardSource = "mac" | "android";

export interface ClipboardEntry {
  content: string;
  contentType: "text" | "html";
  source: ClipboardSource;
  deviceName?: string;
  timestamp: number;
}

// === Daemon API Types ===

export interface DaemonStatus {
  running: boolean;
  version: string;
  uptime: number;
  deviceCount: number;
  connectedCount: number;
}

export interface DaemonEvent {
  type: "clipboard.received" | "device.connected" | "device.disconnected" | "transfer.progress" | "transfer.complete" | "pair.incoming";
  data: Record<string, unknown>;
  timestamp: number;
}

// === Constants ===

export const DAEMON_PORT = 19876;
export const DAEMON_HOST = "127.0.0.1";
export const WEBSOCKET_PORT = 18734;
export const MDNS_SERVICE_TYPE = "raylink";
export const MDNS_SERVICE_PROTOCOL = "tcp";
export const PROTOCOL_VERSION = 1;
export const FILE_CHUNK_SIZE = 64 * 1024; // 64KB
export const CLIPBOARD_POLL_INTERVAL = 500; // ms
export const DATA_DIR_NAME = ".raycast-android";
