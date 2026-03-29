import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface StoredDevice {
  id: string;
  name: string;
  certificateFingerprint: string;
  certificatePem: string;
  pairedAt: number;
  lastSeen: number;
}

interface DeviceStoreData {
  devices: Record<string, StoredDevice>;
}

function getStorePath(): string {
  return join(process.env.HOME || "~", ".raycast-android", "devices.json");
}

export class DeviceStore {
  private devices: Map<string, StoredDevice> = new Map();
  private storePath: string;

  constructor() {
    this.storePath = getStorePath();
  }

  async load(): Promise<void> {
    if (!existsSync(this.storePath)) {
      this.devices = new Map();
      return;
    }
    try {
      const raw = await readFile(this.storePath, "utf-8");
      const data = JSON.parse(raw) as DeviceStoreData;
      this.devices = new Map(Object.entries(data.devices));
    } catch {
      this.devices = new Map();
    }
  }

  async save(): Promise<void> {
    const dir = join(process.env.HOME || "~", ".raycast-android");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const data: DeviceStoreData = {
      devices: Object.fromEntries(this.devices),
    };
    await writeFile(this.storePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  getDevice(id: string): StoredDevice | undefined {
    return this.devices.get(id);
  }

  getAllDevices(): StoredDevice[] {
    return Array.from(this.devices.values());
  }

  isPaired(id: string): boolean {
    return this.devices.has(id);
  }

  isTrustedCertificate(id: string, fingerprint: string): boolean {
    const device = this.devices.get(id);
    return device !== undefined && device.certificateFingerprint === fingerprint;
  }

  async addDevice(device: StoredDevice): Promise<void> {
    this.devices.set(device.id, device);
    await this.save();
  }

  async removeDevice(id: string): Promise<void> {
    this.devices.delete(id);
    await this.save();
  }

  async updateLastSeen(id: string): Promise<void> {
    const device = this.devices.get(id);
    if (device) {
      device.lastSeen = Date.now();
      await this.save();
    }
  }
}
