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
 *
 * We listen to all events but throttle clipboard reads to avoid excessive polling.
 */
class ClipboardAccessibilityService : AccessibilityService() {

    private var lastClipContent: String? = null
    private var lastCheckTime: Long = 0

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        // Throttle: only check clipboard at most every 300ms
        val now = System.currentTimeMillis()
        if (now - lastCheckTime < 300) return
        lastCheckTime = now

        try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = clipboard.primaryClip
            if (clip != null && clip.itemCount > 0) {
                val content = clip.getItemAt(0).text?.toString() ?: return
                if (content == lastClipContent) return
                lastClipContent = content

                // Check if the clip is marked as sensitive (Android 13+)
                if (android.os.Build.VERSION.SDK_INT >= 33) {
                    val extras = clip.description.extras
                    if (extras?.getBoolean("android.content.extra.IS_SENSITIVE", false) == true) {
                        Log.d(TAG, "Skipping sensitive clipboard content")
                        return
                    }
                }

                Log.d(TAG, "Clipboard changed: ${content.take(50)}...")
                onClipboardChanged?.invoke(content)
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
