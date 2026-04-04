package com.raylink.service

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.util.Log

/**
 * Invisible activity that briefly gains focus to read the clipboard.
 *
 * Samsung OneUI denies clipboard access to background services with:
 *   "Denying clipboard access to com.raylink, application is not in focus"
 *
 * This activity takes focus for a single frame, reads the clipboard,
 * passes it to ConnectionService, and finishes immediately.
 */
class ClipboardReaderActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = clipboard.primaryClip
            if (clip != null && clip.itemCount > 0) {
                val content = clip.getItemAt(0).text?.toString()
                if (content != null) {
                    Log.d(TAG, "Read clipboard via activity: ${content.take(50)}...")
                    ConnectionService.onClipboardReadFromActivity?.invoke(content)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read clipboard: ${e.message}")
        }

        finish()
    }

    companion object {
        private const val TAG = "ClipboardReader"
    }
}
