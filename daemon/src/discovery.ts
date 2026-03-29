import { Bonjour, type Service } from "bonjour-service";
import { hostname } from "node:os";
import { MDNS_SERVICE_TYPE, WEBSOCKET_PORT, PROTOCOL_VERSION } from "./protocol.js";

export interface DiscoveredDevice {
  id: string;
  name: string;
  address: string;
  port: number;
}

export class DiscoveryService {
  private bonjour: Bonjour;
  private published: Service | null = null;
  private deviceId: string;
  private deviceName: string;

  constructor(deviceId: string) {
    this.bonjour = new Bonjour();
    this.deviceId = deviceId;
    this.deviceName = hostname();
  }

  advertise(port: number = WEBSOCKET_PORT): void {
    this.published = this.bonjour.publish({
      name: `RayLink-${this.deviceName}`,
      type: MDNS_SERVICE_TYPE,
      port,
      txt: {
        deviceId: this.deviceId,
        deviceName: this.deviceName,
        protocolVersion: String(PROTOCOL_VERSION),
      },
    });
    console.log(`[discovery] Advertising _${MDNS_SERVICE_TYPE}._tcp on port ${port}`);
  }

  stopAdvertising(): void {
    if (this.published) {
      this.published.stop?.();
      this.published = null;
      console.log("[discovery] Stopped advertising");
    }
  }

  destroy(): void {
    this.stopAdvertising();
    this.bonjour.destroy();
  }
}
