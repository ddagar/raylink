package com.raylink.receiver

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity

/**
 * Handles Android share intents — when a user shares a file/text to RayLink.
 * Reads the shared content and sends it to the Mac via the connection service.
 */
class ShareReceiverActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        when (intent?.action) {
            Intent.ACTION_SEND -> handleSend(intent)
            Intent.ACTION_SEND_MULTIPLE -> handleSendMultiple(intent)
        }

        finish()
    }

    private fun handleSend(intent: Intent) {
        // Check for text content first
        intent.getStringExtra(Intent.EXTRA_TEXT)?.let { text ->
            Log.d(TAG, "Sharing text: ${text.take(50)}...")
            // TODO: Send text via ConnectionService
            Toast.makeText(this, "Sending to Mac...", Toast.LENGTH_SHORT).show()
            return
        }

        // Check for file content
        val uri = if (android.os.Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }

        uri?.let {
            Log.d(TAG, "Sharing file: $it")
            // TODO: Read file from ContentResolver and send via ConnectionService
            Toast.makeText(this, "Sending file to Mac...", Toast.LENGTH_SHORT).show()
        }
    }

    private fun handleSendMultiple(intent: Intent) {
        val uris = if (android.os.Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
        }

        uris?.let { list ->
            Log.d(TAG, "Sharing ${list.size} files")
            // TODO: Send each file via ConnectionService
            Toast.makeText(this, "Sending ${list.size} files to Mac...", Toast.LENGTH_SHORT).show()
        }
    }

    companion object {
        private const val TAG = "ShareReceiver"
    }
}
