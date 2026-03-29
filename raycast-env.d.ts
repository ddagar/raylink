/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Download Directory - Where to save files received from your phone */
  "downloadDirectory": string,
  /** Auto Sync Clipboard - Automatically sync clipboard between devices in the background */
  "autoSync": boolean,
  /** Show Notifications - Show HUD notifications when clipboard is synced */
  "showNotifications": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `devices` command */
  export type Devices = ExtensionPreferences & {}
  /** Preferences accessible in the `send-clipboard` command */
  export type SendClipboard = ExtensionPreferences & {}
  /** Preferences accessible in the `pull-clipboard` command */
  export type PullClipboard = ExtensionPreferences & {}
  /** Preferences accessible in the `send-file` command */
  export type SendFile = ExtensionPreferences & {}
  /** Preferences accessible in the `clipboard-history` command */
  export type ClipboardHistory = ExtensionPreferences & {}
  /** Preferences accessible in the `status` command */
  export type Status = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `devices` command */
  export type Devices = {}
  /** Arguments passed to the `send-clipboard` command */
  export type SendClipboard = {}
  /** Arguments passed to the `pull-clipboard` command */
  export type PullClipboard = {}
  /** Arguments passed to the `send-file` command */
  export type SendFile = {}
  /** Arguments passed to the `clipboard-history` command */
  export type ClipboardHistory = {}
  /** Arguments passed to the `status` command */
  export type Status = {}
}

