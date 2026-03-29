import { MenuBarExtra, Icon, open, launchCommand, LaunchType, Clipboard, showHUD } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getDaemonStatus, getDevices, getClipboardHistory, sendClipboard } from "./lib/daemon-client";
import { type Device, type ClipboardEntry } from "./lib/types";

export default function Status() {
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
                  const text = await Clipboard.readText();
                  if (text) {
                    await sendClipboard(text);
                    await showHUD("Clipboard sent to phone");
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
              {history.slice(0, 5).map((entry, i) => (
                <MenuBarExtra.Item
                  key={`${entry.timestamp}-${i}`}
                  title={entry.content.substring(0, 40) + (entry.content.length > 40 ? "..." : "")}
                  icon={entry.source === "android" ? Icon.Mobile : Icon.Monitor}
                  onAction={async () => {
                    await Clipboard.copy(entry.content);
                    await showHUD("Copied to clipboard");
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
