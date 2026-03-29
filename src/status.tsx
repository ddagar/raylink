import { MenuBarExtra, Icon, Clipboard, showHUD, launchCommand, LaunchType, Cache } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getDaemonStatus, getDevices, getClipboardHistory, getLatestClipboardFromPhone, sendClipboard } from "./lib/daemon-client";
import { getPreferences } from "./lib/preferences";
import { type Device, type ClipboardEntry } from "./lib/types";

const cache = new Cache();
const LAST_SYNC_KEY = "lastSyncTimestamp";

export default function Status() {
  const prefs = getPreferences();

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
      const entries = await getClipboardHistory();

      // Auto-sync: check if there's a new clipboard from the phone
      if (prefs.autoSync && entries.length > 0) {
        const latest = entries.find((e) => e.source === "android");
        if (latest) {
          const lastSync = parseInt(cache.get(LAST_SYNC_KEY) || "0", 10);
          if (latest.timestamp > lastSync) {
            // New clipboard from phone — auto-copy to Mac
            await Clipboard.copy(latest.content);
            cache.set(LAST_SYNC_KEY, String(latest.timestamp));
            if (prefs.showNotifications) {
              await showHUD(`Clipboard from ${latest.deviceName || "phone"}`);
            }
          }
        }
      }

      return entries;
    } catch {
      return [] as ClipboardEntry[];
    }
  });

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
