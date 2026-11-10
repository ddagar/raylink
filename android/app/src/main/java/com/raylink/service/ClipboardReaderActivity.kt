package com.raylink.service

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Invisible activity that briefly takes focus to read the clipboard.
 *
 * Android denies clipboard access to apps that are not in focus. The window only has focus
 * once onWindowFocusChanged(true) arrives — reading earlier, in onCreate, is still denied.
 * The activity reads the clipboard at that point, hands it to ConnectionService, and finishes.
 */
class ClipboardReaderActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())
    private var done = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Never linger if focus does not arrive.
        handler.postDelayed({ close() }, FOCUS_TIMEOUT_MS)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || done) return
        try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val content = ClipboardAccessibilityService.textOf(clipboard.primaryClip)
            if (content != null) {
                Log.d(TAG, "Read clipboard via activity (${content.length} chars)")
                ConnectionService.onClipboardReadFromActivity?.invoke(content)
            } else {
                Log.d(TAG, "Clipboard empty or unreadable")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read clipboard: ${e.message}")
        }
        close()
    }

    private fun close() {
        if (done) return
        done = true
        handler.removeCallbacksAndMessages(null)
        finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    companion object {
        private const val TAG = "ClipboardReader"
        private const val FOCUS_TIMEOUT_MS = 1000L
    }
}
