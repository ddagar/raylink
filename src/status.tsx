import { MenuBarExtra, Icon, Clipboard, showHUD, launchCommand, LaunchType, Cache, environment } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getDaemonStatus, getDevices, getClipboardHistory, getTransfers, sendClipboard } from "./lib/daemon-client";
import { getPreferences } from "./lib/preferences";
import { type Device, type ClipboardEntry, type FileTransfer } from "./lib/types";
import { useEffect } from "react";

const cache = new Cache();
const LAST_SYNC_KEY = "lastSyncTimestamp";

export default function Status() {
  const prefs = getPreferences();
  const isBackground = environment.launchType === LaunchType.Background;

  const { data: status } = usePromise(async () => {
    try {
      return await getDaemonStatus();
    } catch {
      return null;
    }
  });

  const { data: devices } = usePromise(async () => {
    try {
      return await getDevices();
    } catch {
      return [] as Device[];
    }
  });

  const { data: history } = usePromise(async () => {
    try {
      return await getClipboardHistory();
    } catch {
      return [] as ClipboardEntry[];
    }
  });

  const { data: transfers } = usePromise(async () => {
    try {
      return await getTransfers();
    } catch {
      return [] as FileTransfer[];
    }
  });

  // Auto-sync: run as a side-effect after history is fetched.
  // This runs on every mount (including background interval refreshes).
  useEffect(() => {
    if (!prefs.autoSync || !history || history.length === 0) return;

    const latest = history.find((e) => e.source === "android");
    if (!latest) return;

    const lastSync = parseInt(cache.get(LAST_SYNC_KEY) || "0", 10);
    if (latest.timestamp <= lastSync) return;

    // New clipboard from phone — auto-copy to Mac
    (async () => {
      try {
        await Clipboard.copy(latest.content);
        cache.set(LAST_SYNC_KEY, String(latest.timestamp));
        if (prefs.showNotifications && !isBackground) {
          await showHUD(`Clipboard from ${latest.deviceName || "phone"}`);
        }
      } catch {
        // Silently fail — will retry on next interval
      }
    })();
  }, [history, prefs.autoSync, prefs.showNotifications, isBackground]);

  const isRunning = !!status?.running;
  const connectedDevices = devices?.filter((d) => d.connected) || [];
  const hasConnection = connectedDevices.length > 0;

  const icon = !isRunning
    ? Icon.XMarkCircle
    : hasConnection
      ? Icon.CheckCircle
      : Icon.Circle;

  const title = hasConnection
    ? connectedDevices[0].name
    : undefined;

  return (
    <MenuBarExtra icon={icon} title={title} tooltip="Android Link">
      {!isRunning ? (
        <MenuBarExtra.Item title="Daemon not running" icon={Icon.ExclamationMark} />
      ) : (
        <>
          <MenuBarExtra.Section title="Status">
            <MenuBarExtra.Item
              title={hasConnection ? `Connected to ${connectedDevices.length} device(s)` : "No devices connected"}
              icon={hasConnection ? Icon.CheckCircle : Icon.Circle}
            />
          </MenuBarExtra.Section>

          {hasConnection && (
            <MenuBarExtra.Section title="Quick Actions">
              <MenuBarExtra.Item
                title="Send Clipboard to Phone"
                icon={Icon.ArrowUp}
                onAction={async () => {
                  try {
                    const text = await Clipboard.readText();
                    if (text) {
                      await sendClipboard(text);
                      await showHUD("Clipboard sent to phone");
                    } else {
                      await showHUD("Clipboard is empty");
                    }
                  } catch {
                    await showHUD("Failed to send clipboard");
                  }
                }}
              />
              <MenuBarExtra.Item
                title="Open Devices"
                icon={Icon.Mobile}
                onAction={() =>
                  launchCommand({ name: "devices", type: LaunchType.UserInitiated })
                }
              />
              <MenuBarExtra.Item
                title="Open Clipboard History"
                icon={Icon.Clipboard}
                onAction={() =>
                  launchCommand({ name: "clipboard-history", type: LaunchType.UserInitiated })
                }
              />
            </MenuBarExtra.Section>
          )}

          {transfers && transfers.length > 0 && (
            <MenuBarExtra.Section title="Recent Transfers">
              {transfers.slice(0, 3).map((t) => {
                const icon = t.status === "completed"
                  ? Icon.CheckCircle
                  : t.status === "in_progress"
                    ? Icon.Clock
                    : t.status === "failed"
                      ? Icon.XMarkCircle
                      : Icon.Document;
                const arrow = t.direction === "incoming" ? "v " : "^ ";
                const progress = t.status === "in_progress" ? ` ${t.progress}%` : "";
                return (
                  <MenuBarExtra.Item
                    key={`xfer-${t.id}`}
                    title={`${arrow}${t.fileName}${progress}`}
                    icon={icon}
                    tooltip={`${t.direction === "incoming" ? "From phone" : "To phone"} - ${t.status}`}
                  />
                );
              })}
            </MenuBarExtra.Section>
          )}

          {history && history.length > 0 && (
            <MenuBarExtra.Section title="Recent Clipboard">
              {history.slice(0, 5).map((entry) => (
                <MenuBarExtra.Item
                  key={`clip-${entry.timestamp}-${entry.source}`}
                  title={entry.content.substring(0, 40) + (entry.content.length > 40 ? "..." : "")}
                  icon={entry.source === "android" ? Icon.Mobile : Icon.Monitor}
                  tooltip={`${entry.source === "android" ? "From phone" : "From Mac"} at ${new Date(entry.timestamp).toLocaleTimeString()}`}
                  onAction={async () => {
                    try {
                      await Clipboard.copy(entry.content);
                      await showHUD("Copied to clipboard");
                    } catch {
                      await showHUD("Failed to copy");
                    }
                  }}
                />
              ))}
            </MenuBarExtra.Section>
          )}
        </>
      )}
    </MenuBarExtra>
  );
}
