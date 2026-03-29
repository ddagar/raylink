import { Clipboard, showHUD, showToast, Toast } from "@raycast/api";
import { sendClipboard } from "./lib/daemon-client";
import { ensureDaemonRunning } from "./lib/daemon-manager";

export default async function SendClipboard() {
  try {
    const running = await ensureDaemonRunning();
    if (!running) {
      await showToast(Toast.Style.Failure, "Daemon not running", "Start the RayLink daemon first");
      return;
    }

    const text = await Clipboard.readText();
    if (!text) {
      await showHUD("Nothing to send — clipboard is empty");
      return;
    }

    await sendClipboard(text);
    await showHUD("Clipboard sent to phone");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const title = msg.includes("No devices connected")
      ? "No phone connected"
      : "Failed to send clipboard";
    await showToast(Toast.Style.Failure, title, msg);
  }
}
