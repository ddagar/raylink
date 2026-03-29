import {
  DAEMON_HOST,
  DAEMON_PORT,
  type DaemonStatus,
  type Device,
  type ClipboardEntry,
  type FileTransfer,
} from "./types";

const BASE_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}`;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Daemon API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

export async function getDaemonStatus(): Promise<DaemonStatus> {
  return request<DaemonStatus>("/status");
}

export async function isDaemonRunning(): Promise<boolean> {
  try {
    await getDaemonStatus();
    return true;
  } catch {
    return false;
  }
}

export async function getDevices(): Promise<Device[]> {
  return request<Device[]>("/devices");
}

export async function pairDevice(
  deviceId: string,
): Promise<{ success: boolean; verificationCode?: string }> {
  return request(`/devices/${deviceId}/pair`, { method: "POST" });
}

export async function unpairDevice(
  deviceId: string,
): Promise<{ success: boolean }> {
  return request(`/devices/${deviceId}/unpair`, { method: "POST" });
}

export async function getPairingState(): Promise<{
  state: string;
  pending: {
    deviceId: string;
    deviceName: string;
    verificationCode: string;
    timestamp: number;
  } | null;
}> {
  return request("/pairing");
}

export async function rejectPairing(): Promise<{ success: boolean }> {
  return request("/pairing/reject", { method: "POST" });
}

export async function sendClipboard(
  content?: string,
): Promise<{ success: boolean }> {
  return request("/clipboard/send", {
    method: "POST",
    body: JSON.stringify(content ? { content } : {}),
  });
}

export async function pullClipboard(): Promise<{ success: boolean }> {
  return request("/clipboard/pull", { method: "POST" });
}

export async function getClipboardHistory(): Promise<ClipboardEntry[]> {
  return request<ClipboardEntry[]>("/clipboard/history");
}

export async function getLatestClipboardFromPhone(): Promise<ClipboardEntry | null> {
  return request<ClipboardEntry | null>("/clipboard/latest");
}

export async function getLatestDeviceClipboard(
  deviceId: string,
): Promise<ClipboardEntry> {
  return request<ClipboardEntry>(`/devices/${deviceId}/clipboard/latest`);
}

export async function sendFile(
  deviceId: string,
  filePath: string,
): Promise<{ success: boolean; transferId: string }> {
  return request(`/devices/${deviceId}/file/send`, {
    method: "POST",
    body: JSON.stringify({ filePath }),
  });
}

export async function getTransfers(): Promise<FileTransfer[]> {
  return request<FileTransfer[]>("/transfers");
}

export async function getTransferStatus(
  transferId: string,
): Promise<FileTransfer> {
  return request<FileTransfer>(`/transfers/${transferId}`);
}
