import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getClipboardHistory, sendClipboard } from "./lib/daemon-client";
import { ensureDaemonRunning } from "./lib/daemon-manager";
import { type ClipboardEntry } from "./lib/types";

export default function ClipboardHistory() {
  const { data: daemonOk } = usePromise(ensureDaemonRunning);

  const {
    data: history,
    isLoading,
    revalidate,
  } = usePromise(
    async () => {
      if (!daemonOk) return [];
      return getClipboardHistory();
    },
    [],
    { execute: daemonOk === true },
  );

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search clipboard history..."
    >
      {history && history.length > 0 ? (
        history.map((entry: ClipboardEntry, index: number) => {
          const isFromPhone = entry.source === "android";
          const sourceLabel = isFromPhone ? entry.deviceName || "Phone" : "Mac";
          const timeStr = new Date(entry.timestamp).toLocaleTimeString();

          return (
            <List.Item
              key={`${entry.timestamp}-${entry.source}-${index}`}
              icon={{
                source: isFromPhone ? Icon.Mobile : Icon.Monitor,
                tintColor: isFromPhone ? Color.Blue : Color.Green,
              }}
              title={
                entry.content.length > 100
                  ? entry.content.substring(0, 100) + "..."
                  : entry.content
              }
              accessories={[
                {
                  tag: {
                    value: sourceLabel,
                    color: isFromPhone ? Color.Blue : Color.Green,
                  },
                },
                { text: timeStr },
              ]}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard content={entry.content} />
                  <Action.Paste content={entry.content} />
                  {!isFromPhone && (
                    <Action
                      title="Send to Phone"
                      icon={Icon.ArrowUp}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
                      onAction={async () => {
                        try {
                          await sendClipboard(entry.content);
                          await showToast(Toast.Style.Success, "Sent to phone");
                        } catch {
                          await showToast(
                            Toast.Style.Failure,
                            "Failed to send",
                          );
                        }
                      }}
                    />
                  )}
                  <Action
                    title="Refresh"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={revalidate}
                  />
                </ActionPanel>
              }
            />
          );
        })
      ) : (
        <List.EmptyView
          icon={Icon.Clipboard}
          title="No clipboard history"
          description="Copy something on your Mac or phone to see it here"
        />
      )}
    </List>
  );
}
