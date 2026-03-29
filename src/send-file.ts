import { showHUD, showToast, Toast, getSelectedFinderItems } from "@raycast/api";
import { getDevices, sendFile } from "./lib/daemon-client";
import { ensureDaemonRunning } from "./lib/daemon-manager";

export default async function SendFile() {
  try {
    const running = await ensureDaemonRunning();
    if (!running) {
      await showToast(Toast.Style.Failure, "Daemon not running", "Start the RayLink daemon first");
      return;
    }

    // Get selected files from Finder
    let filePaths: string[];
    try {
      const items = await getSelectedFinderItems();
      filePaths = items.map((item) => item.path);
    } catch {
      await showToast(Toast.Style.Failure, "No files selected", "Select files in Finder first");
      return;
    }

    if (filePaths.length === 0) {
      await showHUD("No files selected in Finder");
      return;
    }

    // Get first connected device
    const devices = await getDevices();
    const connected = devices.find((d) => d.connected);

    if (!connected) {
      await showToast(Toast.Style.Failure, "No device connected", "Pair and connect your phone first");
      return;
    }

    // Send each file
    for (const filePath of filePaths) {
      await sendFile(connected.id, filePath);
    }

    const fileCount = filePaths.length;
    await showHUD(
      fileCount === 1
        ? `Sending file to ${connected.name}...`
        : `Sending ${fileCount} files to ${connected.name}...`
    );
  } catch (error) {
    await showToast(
      Toast.Style.Failure,
      "Failed to send file",
      error instanceof Error ? error.message : String(error)
    );
  }
}
