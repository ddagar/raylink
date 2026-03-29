import { List, ActionPanel, Action, Icon, Color, showToast, Toast, confirmAlert } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getDevices, unpairDevice, getDaemonStatus, getPairingState, pairDevice, rejectPairing } from "./lib/daemon-client";
import { ensureDaemonRunning } from "./lib/daemon-manager";
import { type Device } from "./lib/types";

export default function Devices() {
  const {
    data: daemonOk,
    isLoading: daemonLoading,
    revalidate: recheckDaemon,
  } = usePromise(async () => {
    return ensureDaemonRunning();
  });

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
    { execute: daemonOk === true }
  );

  const {
    data: pairingState,
    revalidate: reloadPairing,
  } = usePromise(
    async () => {
      if (!daemonOk) return null;
      return getPairingState();
    },
    [],
    { execute: daemonOk === true }
  );

  const isLoading = daemonLoading || devicesLoading;

  if (daemonOk === false) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Daemon Not Running"
          description="The RayLink daemon is not running. Please start it first."
          actions={
            <ActionPanel>
              <Action title="Retry" onAction={recheckDaemon} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  const hasPendingPairing = pairingState?.state === "incoming_request" && pairingState.pending;

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search devices...">
      {hasPendingPairing && pairingState.pending && (
        <List.Section title="Pairing Request">
          <List.Item
            icon={{ source: Icon.Link, tintColor: Color.Orange }}
            title={pairingState.pending.deviceName}
            subtitle={`Verification code: ${pairingState.pending.verificationCode}`}
            accessories={[{ text: "Confirm code matches on both devices" }]}
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
                    title="Unpair Device"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
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
                  <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={reloadDevices} />
                </ActionPanel>
              }
            />
          ))
        ) : (
          <List.Item
            icon={Icon.Info}
            title="No paired devices"
            subtitle="Open the RayLink app on your Android phone to pair"
          />
        )}
      </List.Section>
    </List>
  );
}
