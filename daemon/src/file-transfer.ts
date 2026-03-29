import { createReadStream } from "node:fs";
import { writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { createMessage, FILE_CHUNK_SIZE, type Message } from "./protocol.js";

export type TransferDirection = "incoming" | "outgoing";
export type TransferStatus = "pending" | "in_progress" | "completed" | "failed" | "rejected";

export interface FileTransfer {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  direction: TransferDirection;
  status: TransferStatus;
  progress: number;
  localPath?: string;
  timestamp: number;
  chunks?: Buffer[];
  receivedBytes?: number;
}

const MAX_TRANSFER_HISTORY = 50;

export class FileTransferManager {
  private transfers: Map<string, FileTransfer> = new Map();
  // Per-transfer message senders — fixes the global sender issue for multi-device
  private transferSenders: Map<string, (msg: Message) => void> = new Map();
  private downloadDir: string;
  private onSendMessage: ((msg: Message) => void) | null = null;
  private onTransferComplete: ((transfer: FileTransfer) => void) | null = null;

  constructor(downloadDir?: string) {
    this.downloadDir = downloadDir || join(process.env.HOME || "~", "Downloads");
  }

  setMessageSender(sender: (msg: Message) => void): void {
    this.onSendMessage = sender;
  }

  setOnTransferComplete(callback: (transfer: FileTransfer) => void): void {
    this.onTransferComplete = callback;
  }

  async initiateTransfer(filePath: string, sender?: (msg: Message) => void): Promise<FileTransfer> {
    const stats = await stat(filePath);
    const fileName = basename(filePath);
    const transferId = randomUUID();

    const transfer: FileTransfer = {
      id: transferId,
      fileName,
      fileSize: stats.size,
      mimeType: guessMimeType(fileName),
      direction: "outgoing",
      status: "pending",
      progress: 0,
      localPath: filePath,
      timestamp: Date.now(),
    };

    this.transfers.set(transferId, transfer);
    if (sender) {
      this.transferSenders.set(transferId, sender);
    }

    // Send file offer
    const send = sender || this.onSendMessage;
    send?.(
      createMessage("file.offer", {
        fileName: transfer.fileName,
        fileSize: transfer.fileSize,
        mimeType: transfer.mimeType,
        transferId: transfer.id,
      })
    );

    return transfer;
  }

  handleFileAccept(transferId: string): void {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.direction !== "outgoing") return;

    transfer.status = "in_progress";
    this.sendFileChunks(transfer);
  }

  handleFileReject(transferId: string): void {
    const transfer = this.transfers.get(transferId);
    if (!transfer) return;
    transfer.status = "rejected";
  }

  handleFileOffer(body: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    transferId: string;
  }, sender?: (msg: Message) => void): FileTransfer {
    const transfer: FileTransfer = {
      id: body.transferId,
      fileName: body.fileName,
      fileSize: typeof body.fileSize === "number" ? body.fileSize : parseInt(String(body.fileSize), 10),
      mimeType: body.mimeType,
      direction: "incoming",
      status: "pending",
      progress: 0,
      timestamp: Date.now(),
      chunks: [],
      receivedBytes: 0,
    };

    this.transfers.set(transfer.id, transfer);
    if (sender) {
      this.transferSenders.set(transfer.id, sender);
    }

    // Auto-accept incoming transfers
    const send = sender || this.onSendMessage;
    send?.(
      createMessage("file.accept", { transferId: transfer.id })
    );
    transfer.status = "in_progress";

    console.log(`[file-transfer] Accepting incoming: ${transfer.fileName} (${transfer.fileSize} bytes)`);
    return transfer;
  }

  async handleFileChunk(body: {
    transferId: string;
    data: string;
    offset: number;
    isLast: boolean;
  }): Promise<FileTransfer | null> {
    const transfer = this.transfers.get(body.transferId);
    if (!transfer || transfer.direction !== "incoming") return null;

    const chunk = Buffer.from(body.data, "base64");
    transfer.chunks = transfer.chunks || [];
    transfer.chunks.push(chunk);
    transfer.receivedBytes = (transfer.receivedBytes || 0) + chunk.length;
    transfer.progress = transfer.fileSize > 0
      ? Math.round((transfer.receivedBytes / transfer.fileSize) * 100)
      : 0;

    if (body.isLast) {
      // Write complete file
      const fullData = Buffer.concat(transfer.chunks);
      const savePath = await this.getUniqueFilePath(transfer.fileName);

      if (!existsSync(this.downloadDir)) {
        await mkdir(this.downloadDir, { recursive: true });
      }

      await writeFile(savePath, fullData);
      transfer.localPath = savePath;
      transfer.status = "completed";
      transfer.progress = 100;
      transfer.chunks = undefined; // Free memory
      transfer.receivedBytes = undefined;
      this.transferSenders.delete(transfer.id);

      console.log(`[file-transfer] Saved ${transfer.fileName} to ${savePath}`);
      this.onTransferComplete?.(transfer);
    }

    return transfer;
  }

  getTransfer(id: string): FileTransfer | undefined {
    return this.transfers.get(id);
  }

  getAllTransfers(): FileTransfer[] {
    return Array.from(this.transfers.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_TRANSFER_HISTORY);
  }

  /**
   * Stream file in chunks to avoid loading entire file into memory.
   * For files under 10MB, reads all at once. For larger files, uses a readable stream.
   */
  private async sendFileChunks(transfer: FileTransfer): Promise<void> {
    if (!transfer.localPath) {
      transfer.status = "failed";
      return;
    }

    const send = this.transferSenders.get(transfer.id) || this.onSendMessage;
    if (!send) {
      transfer.status = "failed";
      console.error(`[file-transfer] No sender for transfer ${transfer.id}`);
      return;
    }

    try {
      const stats = await stat(transfer.localPath);
      const fileSize = stats.size;

      if (fileSize <= 10 * 1024 * 1024) {
        // Small file: read all at once (simpler, no back-pressure issues)
        const { readFile } = await import("node:fs/promises");
        const data = await readFile(transfer.localPath);
        let offset = 0;

        while (offset < data.length) {
          const end = Math.min(offset + FILE_CHUNK_SIZE, data.length);
          const chunk = data.subarray(offset, end);
          const isLast = end >= data.length;

          send(
            createMessage("file.chunk", {
              transferId: transfer.id,
              data: chunk.toString("base64"),
              offset,
              isLast,
            })
          );

          offset = end;
          transfer.progress = Math.round((offset / data.length) * 100);
        }
      } else {
        // Large file: stream to avoid memory pressure
        await new Promise<void>((resolve, reject) => {
          const stream = createReadStream(transfer.localPath!, {
            highWaterMark: FILE_CHUNK_SIZE,
          });
          let offset = 0;

          stream.on("data", (chunk: Buffer | string) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            offset += buf.length;
            const isLast = offset >= fileSize;

            send(
              createMessage("file.chunk", {
                transferId: transfer.id,
                data: buf.toString("base64"),
                offset: offset - buf.length,
                isLast,
              })
            );

            transfer.progress = Math.round((offset / fileSize) * 100);
          });

          stream.on("end", resolve);
          stream.on("error", reject);
        });
      }

      transfer.status = "completed";
      transfer.progress = 100;
      this.transferSenders.delete(transfer.id);
      console.log(`[file-transfer] Sent ${transfer.fileName} (${fileSize} bytes)`);
      this.onTransferComplete?.(transfer);
    } catch (err) {
      transfer.status = "failed";
      this.transferSenders.delete(transfer.id);
      console.error(`[file-transfer] Failed to send ${transfer.fileName}:`, err);
    }
  }

  private async getUniqueFilePath(fileName: string): Promise<string> {
    let filePath = join(this.downloadDir, fileName);
    let counter = 1;

    while (existsSync(filePath)) {
      const ext = fileName.includes(".") ? "." + fileName.split(".").pop() : "";
      const base = ext ? fileName.slice(0, -ext.length) : fileName;
      filePath = join(this.downloadDir, `${base} (${counter})${ext}`);
      counter++;
    }

    return filePath;
  }
}

function guessMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    txt: "text/plain",
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    zip: "application/zip",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    mov: "video/quicktime",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    apk: "application/vnd.android.package-archive",
  };
  return mimeMap[ext || ""] || "application/octet-stream";
}
