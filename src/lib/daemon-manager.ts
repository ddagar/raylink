import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { isDaemonRunning } from "./daemon-client";

const LAUNCH_AGENT_LABEL = "com.raycast-android.daemon";
const LAUNCH_AGENT_DIR = join(homedir(), "Library", "LaunchAgents");
const LAUNCH_AGENT_PATH = join(LAUNCH_AGENT_DIR, `${LAUNCH_AGENT_LABEL}.plist`);
const DATA_DIR = join(homedir(), ".raycast-android");
const LOG_DIR = join(DATA_DIR, "logs");

function getDaemonDir(): string {
  // In development, use the local daemon directory
  // In production, this should be the installed location
  return join(__dirname, "..", "..", "daemon");
}

export async function ensureDaemonRunning(): Promise<boolean> {
  if (await isDaemonRunning()) {
    return true;
  }

  // Try to start the daemon
  return startDaemon();
}

export async function startDaemon(): Promise<boolean> {
  // Ensure log directory exists
  if (!existsSync(LOG_DIR)) {
    await mkdir(LOG_DIR, { recursive: true });
  }

  // Check if LaunchAgent is installed
  if (existsSync(LAUNCH_AGENT_PATH)) {
    // Try loading it
    return new Promise((resolve) => {
      execFile("launchctl", ["load", LAUNCH_AGENT_PATH], (err) => {
        if (err) {
          console.error("Failed to load LaunchAgent:", err.message);
          // Fall back to direct start
          startDaemonDirectly().then(resolve);
        } else {
          // Give it a moment to start
          setTimeout(async () => {
            resolve(await isDaemonRunning());
          }, 2000);
        }
      });
    });
  }

  // Start directly
  return startDaemonDirectly();
}

async function startDaemonDirectly(): Promise<boolean> {
  const daemonDir = getDaemonDir();
  const entryPoint = join(daemonDir, "dist", "index.js");

  // Check if daemon is built
  if (!existsSync(entryPoint)) {
    // Try using tsx for development
    const tsEntry = join(daemonDir, "src", "index.ts");
    if (!existsSync(tsEntry)) {
      throw new Error("Daemon not found. Please build the daemon first.");
    }

    // Start with tsx
    const npxPath = await findExecutable("npx");
    const proc = execFile(npxPath, ["tsx", tsEntry], {
      cwd: daemonDir,
      env: { ...process.env, HOME: homedir() },
    });

    proc.unref();

    // Wait for daemon to start
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return isDaemonRunning();
  }

  // Start with node
  const nodePath = await findExecutable("node");
  const proc = execFile(nodePath, [entryPoint], {
    env: { ...process.env, HOME: homedir() },
  });

  proc.unref();

  await new Promise((resolve) => setTimeout(resolve, 2000));
  return isDaemonRunning();
}

export async function stopDaemon(): Promise<void> {
  if (existsSync(LAUNCH_AGENT_PATH)) {
    return new Promise((resolve) => {
      execFile("launchctl", ["unload", LAUNCH_AGENT_PATH], () => {
        resolve();
      });
    });
  }
}

export async function installLaunchAgent(): Promise<void> {
  const daemonDir = getDaemonDir();
  const templatePath = join(daemonDir, "com.raycast-android.daemon.plist");

  if (!existsSync(templatePath)) {
    throw new Error("LaunchAgent template not found");
  }

  let plist = await readFile(templatePath, "utf-8");
  const nodePath = await findExecutable("node");
  const entryPoint = join(daemonDir, "dist", "index.js");

  plist = plist.replace(/__NODE_PATH__/g, nodePath);
  plist = plist.replace(/__DAEMON_ENTRY__/g, entryPoint);
  plist = plist.replace(/__LOG_DIR__/g, LOG_DIR);
  plist = plist.replace(/__HOME__/g, homedir());

  if (!existsSync(LAUNCH_AGENT_DIR)) {
    await mkdir(LAUNCH_AGENT_DIR, { recursive: true });
  }

  await writeFile(LAUNCH_AGENT_PATH, plist);
}

export async function uninstallLaunchAgent(): Promise<void> {
  await stopDaemon();
  if (existsSync(LAUNCH_AGENT_PATH)) {
    const { unlink } = await import("node:fs/promises");
    await unlink(LAUNCH_AGENT_PATH);
  }
}

function findExecutable(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("which", [name], (err, stdout) => {
      if (err) reject(new Error(`${name} not found`));
      else resolve(stdout.trim());
    });
  });
}
