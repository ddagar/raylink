import { randomUUID } from "node:crypto";

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
  | "clipboard.connect"
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
  certificate: string;
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

export interface FileChunkBody {
  transferId: string;
  data: string; // base64-encoded
  offset: number;
  isLast: boolean;
}

// === Constants ===

export const WEBSOCKET_PORT = 18734;
export const DAEMON_PORT = 19876;
export const MDNS_SERVICE_TYPE = "raylink";
export const PROTOCOL_VERSION = 1;
export const FILE_CHUNK_SIZE = 64 * 1024; // 64KB

// === Helpers ===

export function createMessage(type: MessageType, body: Record<string, unknown> = {}): Message {
  return {
    id: randomUUID(),
    type,
    timestamp: Date.now(),
    body,
  };
}

export function parseMessage(raw: string): Message | null {
  try {
    const msg = JSON.parse(raw) as Message;
    if (!msg.id || !msg.type || !msg.timestamp) return null;
    return msg;
  } catch {
    return null;
  }
}

export function serializeMessage(msg: Message): string {
  return JSON.stringify(msg);
}
