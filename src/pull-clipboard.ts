import { Clipboard, showHUD, showToast, Toast } from "@raycast/api";
import { pullClipboard, getClipboardHistory } from "./lib/daemon-client";
import { ensureDaemonRunning } from "./lib/daemon-manager";

export default async function PullClipboard() {
  try {
    const running = await ensureDaemonRunning();
    if (!running) {
      await showToast(Toast.Style.Failure, "Daemon not running", "Start the RayLink daemon first");
      return;
    }

    await pullClipboard();

    // Wait briefly for the clipboard to arrive
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Check if we got something
    const history = await getClipboardHistory();
    const latest = history.find((e) => e.source === "android");

    if (latest) {
      await Clipboard.copy(latest.content);
      await showHUD("Clipboard pulled from phone");
    } else {
      await showHUD("Requested clipboard from phone — check back shortly");
    }
  } catch (error) {
    await showToast(
      Toast.Style.Failure,
      "Failed to pull clipboard",
      error instanceof Error ? error.message : String(error)
    );
  }
}
