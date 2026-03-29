import { computeVerificationCode, computeFingerprint } from "./certificate.js";
import { DeviceStore, type StoredDevice } from "./device-store.js";
import { createMessage, type Message, type PairRequestBody, type PairAcceptBody } from "./protocol.js";

export type PairingState = "idle" | "incoming_request" | "outgoing_request";

export interface PendingPairing {
  deviceId: string;
  deviceName: string;
  certificate: string;
  verificationCode: string;
  timestamp: number;
}

const PAIRING_TIMEOUT = 30_000; // 30 seconds

export class PairingManager {
  private state: PairingState = "idle";
  private pending: PendingPairing | null = null;
  private localCert: string;
  private localDeviceId: string;
  private localDeviceName: string;
  private deviceStore: DeviceStore;

  private onSendMessage: ((msg: Message) => void) | null = null;
  private onPairingComplete: ((device: StoredDevice) => void) | null = null;
  private onPairingRequest: ((pending: PendingPairing) => void) | null = null;

  constructor(
    localCert: string,
    localDeviceId: string,
    localDeviceName: string,
    deviceStore: DeviceStore
  ) {
    this.localCert = localCert;
    this.localDeviceId = localDeviceId;
    this.localDeviceName = localDeviceName;
    this.deviceStore = deviceStore;
  }

  setMessageSender(sender: (msg: Message) => void): void {
    this.onSendMessage = sender;
  }

  setOnPairingComplete(callback: (device: StoredDevice) => void): void {
    this.onPairingComplete = callback;
  }

  setOnPairingRequest(callback: (pending: PendingPairing) => void): void {
    this.onPairingRequest = callback;
  }

  getState(): PairingState {
    return this.state;
  }

  getPending(): PendingPairing | null {
    return this.pending;
  }

  handlePairRequest(body: PairRequestBody): void {
    if (this.deviceStore.isPaired(body.deviceId)) {
      // Already paired, accept immediately
      this.onSendMessage?.(
        createMessage("pair.accept", {
          deviceName: this.localDeviceName,
          deviceId: this.localDeviceId,
          certificate: this.localCert,
        } satisfies PairAcceptBody)
      );
      return;
    }

    const verificationCode = computeVerificationCode(this.localCert, body.certificate);

    this.state = "incoming_request";
    this.pending = {
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      certificate: body.certificate,
      verificationCode,
      timestamp: Date.now(),
    };

    console.log(`[pairing] Incoming pair request from ${body.deviceName}`);
    console.log(`[pairing] Verification code: ${verificationCode}`);

    this.onPairingRequest?.(this.pending);

    // Auto-timeout
    setTimeout(() => {
      if (this.state === "incoming_request" && this.pending?.deviceId === body.deviceId) {
        this.rejectPairing();
      }
    }, PAIRING_TIMEOUT);
  }

  async acceptPairing(): Promise<void> {
    if (this.state !== "incoming_request" || !this.pending) {
      console.warn("[pairing] No pending pairing to accept");
      return;
    }

    const device: StoredDevice = {
      id: this.pending.deviceId,
      name: this.pending.deviceName,
      certificateFingerprint: computeFingerprint(this.pending.certificate),
      certificatePem: this.pending.certificate,
      pairedAt: Date.now(),
      lastSeen: Date.now(),
    };

    await this.deviceStore.addDevice(device);

    this.onSendMessage?.(
      createMessage("pair.accept", {
        deviceName: this.localDeviceName,
        deviceId: this.localDeviceId,
        certificate: this.localCert,
      } satisfies PairAcceptBody)
    );

    console.log(`[pairing] Paired with ${device.name}`);
    this.onPairingComplete?.(device);

    this.state = "idle";
    this.pending = null;
  }

  rejectPairing(): void {
    if (!this.pending) return;

    console.log(`[pairing] Rejected pairing with ${this.pending.deviceName}`);
    this.onSendMessage?.(createMessage("pair.reject"));

    this.state = "idle";
    this.pending = null;
  }

  async handlePairAccept(body: PairAcceptBody): Promise<void> {
    if (this.state !== "outgoing_request") {
      // Could be auto-accept from an already-paired device
      // Store/update anyway
    }

    const device: StoredDevice = {
      id: body.deviceId,
      name: body.deviceName,
      certificateFingerprint: computeFingerprint(body.certificate),
      certificatePem: body.certificate,
      pairedAt: Date.now(),
      lastSeen: Date.now(),
    };

    await this.deviceStore.addDevice(device);
    this.onPairingComplete?.(device);

    console.log(`[pairing] Pairing accepted by ${device.name}`);
    this.state = "idle";
    this.pending = null;
  }

  handlePairReject(): void {
    console.log("[pairing] Pairing rejected by remote device");
    this.state = "idle";
    this.pending = null;
  }

  async unpairDevice(deviceId: string): Promise<void> {
    await this.deviceStore.removeDevice(deviceId);
    console.log(`[pairing] Unpaired device ${deviceId}`);
  }
}
