import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  confirmAlert,
  Detail,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import {
  getDevices,
  unpairDevice,
  getPairingState,
  pairDevice,
  rejectPairing,
} from "./lib/daemon-client";
import { ensureDaemonRunning, startDaemon } from "./lib/daemon-manager";
import { type Device } from "./lib/types";

const SETUP_GUIDE = `
# RayLink Setup

## 1. Start the Daemon
The RayLink daemon runs in the background and handles communication with your phone.

\`\`\`bash
cd daemon && npm run build && node dist/index.js
\`\`\`

Or install as a Launch Agent for auto-start on login.

## 2. Install RayLink on Android
Build and install the companion app on your Android phone.

## 3. Connect
1. Make sure both devices are on the **same WiFi network**
2. Open RayLink on your phone
3. Enable the **Accessibility Service** (for clipboard sync)
4. Tap **Start Connection** — your Mac will appear automatically
5. Confirm the **6-digit verification code** matches on both devices

## 4. Use
- **Clipboard** syncs automatically in both directions
- **Send files** from Mac: select files in Finder, then use the "Send File to Phone" command
- **Send files** from phone: use the Android share sheet and select RayLink
`;

export default function Devices() {
  const {
    data: daemonOk,
    isLoading: daemonLoading,
    revalidate: recheckDaemon,
  } = usePromise(ensureDaemonRunning);

  const {
    data: devices,
    isLoading: devicesLoading,
    revalidate: reloadDevices,
  } = usePromise(
    async () => {
      if (!daemonOk) return [];
      return getDevices();
    },
    [],
    { execute: daemonOk === true },
  );

  const { data: pairingState, revalidate: reloadPairing } = usePromise(
    async () => {
      if (!daemonOk) return null;
      return getPairingState();
    },
    [],
    { execute: daemonOk === true },
  );

  const isLoading = daemonLoading || devicesLoading;

  if (daemonOk === false) {
    return (
      <Detail
        markdown={SETUP_GUIDE}
        actions={
          <ActionPanel>
            <Action
              title="Start Daemon"
              icon={Icon.Play}
              onAction={async () => {
                const toast = await showToast(
                  Toast.Style.Animated,
                  "Starting daemon...",
                );
                try {
                  await startDaemon();
                  toast.style = Toast.Style.Success;
                  toast.title = "Daemon started";
                  recheckDaemon();
                } catch {
                  toast.style = Toast.Style.Failure;
                  toast.title = "Failed to start daemon";
                }
              }}
            />
            <Action
              title="Retry Connection"
              icon={Icon.ArrowClockwise}
              onAction={recheckDaemon}
            />
          </ActionPanel>
        }
      />
    );
  }

  const hasPendingPairing =
    pairingState?.state === "incoming_request" && pairingState.pending;

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search devices...">
      {hasPendingPairing && pairingState.pending && (
        <List.Section title="Incoming Pairing Request">
          <List.Item
            icon={{ source: Icon.Link, tintColor: Color.Orange }}
            title={pairingState.pending.deviceName}
            subtitle={`Code: ${pairingState.pending.verificationCode}`}
            accessories={[{ text: "Verify this code matches your phone" }]}
            actions={
              <ActionPanel>
                <Action
                  title="Accept Pairing"
                  icon={Icon.Check}
                  onAction={async () => {
                    await pairDevice(pairingState.pending!.deviceId);
                    await showToast(Toast.Style.Success, "Device paired!");
                    reloadDevices();
                    reloadPairing();
                  }}
                />
                <Action
                  title="Reject"
                  icon={Icon.XMarkCircle}
                  style={Action.Style.Destructive}
                  onAction={async () => {
                    await rejectPairing();
                    reloadPairing();
                  }}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      <List.Section title="Paired Devices">
        {devices && devices.length > 0 ? (
          devices.map((device: Device) => (
            <List.Item
              key={device.id}
              icon={{
                source: Icon.Mobile,
                tintColor: device.connected ? Color.Green : Color.SecondaryText,
              }}
              title={device.name}
              subtitle={device.id.substring(0, 8)}
              accessories={[
                {
                  tag: {
                    value: device.connected ? "Connected" : "Offline",
                    color: device.connected ? Color.Green : Color.SecondaryText,
                  },
                },
                {
                  text: device.lastSeen
                    ? `Last seen: ${new Date(device.lastSeen).toLocaleTimeString()}`
                    : undefined,
                },
              ]}
              actions={
                <ActionPanel>
                  <Action
                    title="Refresh"
                    icon={Icon.ArrowClockwise}
                    onAction={reloadDevices}
                  />
                  <Action
                    title="Unpair Device"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                    onAction={async () => {
                      if (
                        await confirmAlert({
                          title: "Unpair Device",
                          message: `Are you sure you want to unpair ${device.name}?`,
                        })
                      ) {
                        await unpairDevice(device.id);
                        await showToast(Toast.Style.Success, "Device unpaired");
                        reloadDevices();
                      }
                    }}
                  />
                </ActionPanel>
              }
            />
          ))
        ) : (
          <List.Item
            icon={Icon.Mobile}
            title="No paired devices"
            subtitle="Open RayLink on your Android phone to pair"
            actions={
              <ActionPanel>
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  onAction={reloadDevices}
                />
              </ActionPanel>
            }
          />
        )}
      </List.Section>
    </List>
  );
}
