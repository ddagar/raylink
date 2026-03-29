import { List, ActionPanel, Action, Icon, Color } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getClipboardHistory } from "./lib/daemon-client";
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
    { execute: daemonOk === true }
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search clipboard history...">
      {history && history.length > 0 ? (
        history.map((entry: ClipboardEntry, index: number) => (
          <List.Item
            key={`${entry.timestamp}-${index}`}
            icon={{
              source: entry.source === "android" ? Icon.Mobile : Icon.Monitor,
              tintColor: entry.source === "android" ? Color.Blue : Color.Green,
            }}
            title={entry.content.substring(0, 100)}
            subtitle={entry.content.length > 100 ? "..." : undefined}
            accessories={[
              {
                tag: {
                  value: entry.source === "android" ? "Phone" : "Mac",
                  color: entry.source === "android" ? Color.Blue : Color.Green,
                },
              },
              {
                text: new Date(entry.timestamp).toLocaleTimeString(),
              },
            ]}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard content={entry.content} />
                <Action.Paste content={entry.content} />
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={revalidate} />
              </ActionPanel>
            }
          />
        ))
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
