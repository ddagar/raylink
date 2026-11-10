package com.raylink.service

import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityEvent

/**
 * Detects that the user copied something and gets the clipboard content to ConnectionService.
 *
 * Android only lets the focused app read the clipboard, and does not notify background apps
 * of clipboard changes; a denied read returns null rather than throwing. So this service
 * watches for signs of a copy (a tap on a "Copy"/"Cut" control, a "Copied" toast, the system
 * clipboard overlay) and then reads the clipboard, through ClipboardReaderActivity when the
 * direct read is denied. An accessibility service is allowed to start that activity from the
 * background; a plain foreground service is not.
 */
class ClipboardAccessibilityService : AccessibilityService() {

    private val handler = Handler(Looper.getMainLooper())
    private val readClipboard = Runnable { readClipboardNow() }
    private var lastClipContent: String? = null
    private var lastReaderLaunch = 0L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || event.packageName == packageName) return
        if (SystemClock.elapsedRealtime() < ignoreSignalsUntil) return
        if (!looksLikeCopy(event)) return
        // Give the source app a moment to actually put the content on the clipboard.
        handler.removeCallbacks(readClipboard)
        handler.postDelayed(readClipboard, COPY_SETTLE_MS)
    }

    private fun looksLikeCopy(event: AccessibilityEvent): Boolean {
        return when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_CLICKED,
            AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED -> {
                val label = buildString {
                    event.text.forEach { append(it).append(' ') }
                    event.contentDescription?.let { append(it) }
                }
                label.length <= MAX_LABEL_LENGTH && COPY_LABEL.containsMatchIn(label)
            }
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ->
                event.packageName == "com.android.systemui" &&
                    event.className?.contains("clipboard", ignoreCase = true) == true
            else -> false
        }
    }

    private fun readClipboardNow() {
        val content = try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            textOf(clipboard.primaryClip)
        } catch (e: Exception) {
            null
        }

        if (content != null) {
            if (content == lastClipContent) return
            lastClipContent = content
            Log.d(TAG, "Clipboard read directly (${content.length} chars)")
            onClipboardChanged?.invoke(content)
        } else {
            launchReader()
        }
    }

    /** Briefly shows the invisible reader activity, which can read the clipboard once focused. */
    fun launchReader() {
        if (!ConnectionService.isPairedStatus) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastReaderLaunch < MIN_READER_INTERVAL_MS) return
        lastReaderLaunch = now
        try {
            startActivity(
                Intent(this, ClipboardReaderActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
            )
            Log.d(TAG, "Launched clipboard reader")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch clipboard reader: ${e.message}")
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
        handler.removeCallbacks(readClipboard)
        instance = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "ClipboardA11y"
        private const val COPY_SETTLE_MS = 250L
        private const val MIN_READER_INTERVAL_MS = 800L
        private const val MAX_LABEL_LENGTH = 80
        private const val IGNORE_OWN_WRITE_MS = 1500L

        /** Labels of copy/cut controls and "copied" confirmations, English and Russian. */
        private val COPY_LABEL = Regex("\\b(copy|copied|cut)\\b|копир|вырез", RegexOption.IGNORE_CASE)

        var instance: ClipboardAccessibilityService? = null
            private set

        var onClipboardChanged: ((String) -> Unit)? = null

        @Volatile private var ignoreSignalsUntil = 0L

        /** Call just before this app sets the clipboard itself, so it is not read back. */
        fun ignoreCopySignals() {
            ignoreSignalsUntil = SystemClock.elapsedRealtime() + IGNORE_OWN_WRITE_MS
        }

        /** Plain text of a clip, or null when there is none or it is marked sensitive. */
        fun textOf(clip: ClipData?): String? {
            if (clip == null || clip.itemCount == 0) return null
            if (android.os.Build.VERSION.SDK_INT >= 33 &&
                clip.description.extras?.getBoolean("android.content.extra.IS_SENSITIVE", false) == true
            ) {
                Log.d(TAG, "Skipping sensitive clipboard content")
                return null
            }
            return clip.getItemAt(0).text?.toString()?.takeIf { it.isNotEmpty() }
        }
    }
}
