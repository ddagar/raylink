package com.raylink.service

import android.accessibilityservice.AccessibilityService
import android.content.ClipboardManager
import android.content.Context
import android.util.Log
import android.view.accessibility.AccessibilityEvent

/**
 * Accessibility service for monitoring clipboard changes.
 *
 * On Android 10+, background apps cannot read the clipboard.
 * An Accessibility Service can detect clipboard change events and read content.
 * The user must manually enable this in Settings > Accessibility.
 */
class ClipboardAccessibilityService : AccessibilityService() {

    private var lastClipContent: String? = null

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // We're primarily interested in clipboard changes
        // The system sends TYPE_CLIPBOARD_CHANGED (API 33+) or we detect via other events
        if (event == null) return

        // Try to read clipboard on relevant events
        try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = clipboard.primaryClip
            if (clip != null && clip.itemCount > 0) {
                val content = clip.getItemAt(0).text?.toString()
                if (content != null && content != lastClipContent) {
                    lastClipContent = content

                    // Check if the clip is marked as sensitive (Android 13+)
                    if (android.os.Build.VERSION.SDK_INT >= 33) {
                        val desc = clip.description
                        val extras = desc.extras
                        if (extras?.getBoolean("android.content.extra.IS_SENSITIVE", false) == true) {
                            Log.d(TAG, "Skipping sensitive clipboard content")
                            return
                        }
                    }

                    Log.d(TAG, "Clipboard changed: ${content.take(50)}...")
                    onClipboardChanged?.invoke(content)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error reading clipboard: ${e.message}")
        }
    }

    override fun onInterrupt() {
        Log.d(TAG, "Accessibility service interrupted")
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.d(TAG, "Accessibility service connected")
        instance = this
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "ClipboardA11y"

        var instance: ClipboardAccessibilityService? = null
            private set

        var onClipboardChanged: ((String) -> Unit)? = null
    }
}
