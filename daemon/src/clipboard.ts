import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

export interface ClipboardEntry {
  content: string;
  contentType: "text" | "html";
  source: "mac" | "android";
  deviceId?: string;
  deviceName?: string;
  timestamp: number;
}

const MAX_HISTORY = 50;
const MAX_CLIPBOARD_SIZE = 5 * 1024 * 1024; // 5MB
const PBCOPY_TIMEOUT = 5000; // 5 seconds

export class ClipboardMonitor {
  private lastHash: string = "";
  private interval: ReturnType<typeof setInterval> | null = null;
  private history: ClipboardEntry[] = [];
  private onChange: ((content: string) => void) | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  onClipboardChange(callback: (content: string) => void): void {
    this.onChange = callback;
  }

  start(pollIntervalMs: number = 500): void {
    if (this.interval) return;

    // Read initial clipboard state
    this.readClipboard().then((content) => {
      if (content) {
        this.lastHash = this.hash(content);
      }
    });

    this.interval = setInterval(async () => {
      const content = await this.readClipboard();
      if (content === null) return;

      const currentHash = this.hash(content);
      if (currentHash !== this.lastHash) {
        this.lastHash = currentHash;

        // Only fire onChange for content within size limit
        if (content.length <= MAX_CLIPBOARD_SIZE) {
          this.onChange?.(content);
        } else {
          console.warn(`[clipboard] Content too large (${content.length} bytes), skipping broadcast`);
        }
      }
    }, pollIntervalMs);

    console.log(`[clipboard] Monitoring started (${pollIntervalMs}ms interval)`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log("[clipboard] Monitoring stopped");
    }
  }

  /**
   * Set the macOS clipboard. Writes are serialized via a queue to prevent
   * concurrent pbcopy calls. Includes a timeout to prevent permanent stalls.
   */
  async setClipboard(content: string): Promise<void> {
    // Chain writes to serialize concurrent calls
    this.writeQueue = this.writeQueue.then(
      () => this.doSetClipboard(content),
      () => this.doSetClipboard(content) // continue queue even if previous write failed
    );
    return this.writeQueue;
  }

  private doSetClipboard(content: string): Promise<void> {
    const contentHash = this.hash(content);

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.kill();
        // Update hash anyway to prevent change detection loop
        this.lastHash = contentHash;
        reject(new Error("pbcopy timed out"));
      }, PBCOPY_TIMEOUT);

      const proc = execFile("pbcopy", [], (err) => {
        clearTimeout(timer);
        // Always update the hash so polling doesn't detect our own write
        this.lastHash = contentHash;
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
      proc.stdin?.write(content);
      proc.stdin?.end();
    });
  }

  async getClipboard(): Promise<string | null> {
    return this.readClipboard();
  }

  addToHistory(entry: ClipboardEntry): void {
    this.history.unshift(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history.pop();
    }
  }

  getHistory(): ClipboardEntry[] {
    return [...this.history];
  }

  getLatestFromDevice(deviceId?: string): ClipboardEntry | undefined {
    if (deviceId) {
      return this.history.find((e) => e.source === "android" && e.deviceId === deviceId);
    }
    return this.history.find((e) => e.source === "android");
  }

  private async readClipboard(): Promise<string | null> {
    return new Promise((resolve) => {
      execFile("pbpaste", [], (err, stdout) => {
        if (err) {
          resolve(null);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  private hash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }
}
