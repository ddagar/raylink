import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
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

const MAX_TRANSFER_HISTORY = 20;

export class FileTransferManager {
  private transfers: Map<string, FileTransfer> = new Map();
  private downloadDir: string;
  private onSendMessage: ((msg: Message) => void) | null = null;

  constructor(downloadDir?: string) {
    this.downloadDir = downloadDir || join(process.env.HOME || "~", "Downloads");
  }

  setMessageSender(sender: (msg: Message) => void): void {
    this.onSendMessage = sender;
  }

  async initiateTransfer(filePath: string): Promise<FileTransfer> {
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

    // Send file offer
    this.onSendMessage?.(
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
  }): FileTransfer {
    const transfer: FileTransfer = {
      id: body.transferId,
      fileName: body.fileName,
      fileSize: body.fileSize,
      mimeType: body.mimeType,
      direction: "incoming",
      status: "pending",
      progress: 0,
      timestamp: Date.now(),
      chunks: [],
      receivedBytes: 0,
    };

    this.transfers.set(transfer.id, transfer);

    // Auto-accept incoming transfers
    this.onSendMessage?.(
      createMessage("file.accept", { transferId: transfer.id })
    );
    transfer.status = "in_progress";

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
    transfer.progress = Math.round(
      (transfer.receivedBytes / transfer.fileSize) * 100
    );

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

      console.log(`[file-transfer] Saved ${transfer.fileName} to ${savePath}`);
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

  private async sendFileChunks(transfer: FileTransfer): Promise<void> {
    if (!transfer.localPath) {
      transfer.status = "failed";
      return;
    }

    try {
      const data = await readFile(transfer.localPath);
      let offset = 0;

      while (offset < data.length) {
        const end = Math.min(offset + FILE_CHUNK_SIZE, data.length);
        const chunk = data.subarray(offset, end);
        const isLast = end >= data.length;

        this.onSendMessage?.(
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

      transfer.status = "completed";
      transfer.progress = 100;
      console.log(`[file-transfer] Sent ${transfer.fileName}`);
    } catch (err) {
      transfer.status = "failed";
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
