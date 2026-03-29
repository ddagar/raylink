import { showHUD, showToast, Toast, getSelectedFinderItems } from "@raycast/api";
import { getDevices, sendFile, getTransferStatus } from "./lib/daemon-client";
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

    // Send each file with progress tracking
    const transferIds: string[] = [];
    for (const filePath of filePaths) {
      const result = await sendFile(connected.id, filePath);
      transferIds.push(result.transferId);
    }

    const fileCount = filePaths.length;
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: fileCount === 1
        ? `Sending file to ${connected.name}...`
        : `Sending ${fileCount} files to ${connected.name}...`,
    });

    // Poll for completion
    const pollCompletion = async () => {
      for (let i = 0; i < 120; i++) { // Max 2 minutes
        await new Promise((r) => setTimeout(r, 1000));

        let allDone = true;
        let anyFailed = false;

        for (const id of transferIds) {
          try {
            const status = await getTransferStatus(id);
            if (status.status === "failed") {
              anyFailed = true;
            } else if (status.status !== "completed") {
              allDone = false;
            }
          } catch {
            // Transfer not found, skip
          }
        }

        if (allDone || anyFailed) {
          if (anyFailed) {
            toast.style = Toast.Style.Failure;
            toast.title = "Some files failed to send";
          } else {
            toast.style = Toast.Style.Success;
            toast.title = fileCount === 1
              ? `File sent to ${connected.name}`
              : `${fileCount} files sent to ${connected.name}`;
          }
          return;
        }
      }

      toast.style = Toast.Style.Failure;
      toast.title = "Transfer timed out";
    };

    await pollCompletion();
  } catch (error) {
    await showToast(
      Toast.Style.Failure,
      "Failed to send file",
      error instanceof Error ? error.message : String(error)
    );
  }
}
