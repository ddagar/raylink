import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

export interface ClipboardEntry {
  content: string;
  contentType: "text" | "html";
  source: "mac" | "android";
  deviceName?: string;
  timestamp: number;
}

const MAX_HISTORY = 50;

export class ClipboardMonitor {
  private lastHash: string = "";
  private interval: ReturnType<typeof setInterval> | null = null;
  private history: ClipboardEntry[] = [];
  private onChange: ((content: string) => void) | null = null;
  private suppressNextChange = false;

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

        if (this.suppressNextChange) {
          this.suppressNextChange = false;
          return;
        }

        this.onChange?.(content);
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

  async setClipboard(content: string): Promise<void> {
    // Suppress the next change detection since we're setting it ourselves
    this.suppressNextChange = true;
    this.lastHash = this.hash(content);

    return new Promise((resolve, reject) => {
      const proc = execFile("pbcopy", [], (err) => {
        if (err) reject(err);
        else resolve();
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

  getLatestFromDevice(): ClipboardEntry | undefined {
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
