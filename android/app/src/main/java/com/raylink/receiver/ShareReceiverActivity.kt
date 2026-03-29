package com.raylink.receiver

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import com.raylink.service.ConnectionService
import java.io.ByteArrayOutputStream
import java.util.UUID

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
        // Check for text content first — send as clipboard
        intent.getStringExtra(Intent.EXTRA_TEXT)?.let { text ->
            Log.d(TAG, "Sharing text: ${text.take(50)}...")
            ConnectionService.sendClipboardFromShare(text)
            Toast.makeText(this, "Sent to Mac", Toast.LENGTH_SHORT).show()
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
            sendFileUri(it)
        }
    }

    private fun handleSendMultiple(intent: Intent) {
        val uris = if (android.os.Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
        }

        uris?.forEach { uri ->
            sendFileUri(uri)
        }
    }

    private fun sendFileUri(uri: Uri) {
        try {
            val fileName = getFileName(uri) ?: "shared_file"
            val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"
            val data = readUriToBytes(uri) ?: run {
                Toast.makeText(this, "Failed to read file", Toast.LENGTH_SHORT).show()
                return
            }

            val transferId = UUID.randomUUID().toString()
            Log.d(TAG, "Sharing file: $fileName ($mimeType, ${data.size} bytes)")

            ConnectionService.sendFileFromShare(transferId, fileName, mimeType, data)
            Toast.makeText(this, "Sending $fileName to Mac...", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to share file: ${e.message}")
            Toast.makeText(this, "Failed to send file", Toast.LENGTH_SHORT).show()
        }
    }

    private fun getFileName(uri: Uri): String? {
        contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex >= 0) {
                    return cursor.getString(nameIndex)
                }
            }
        }
        return uri.lastPathSegment
    }

    private fun readUriToBytes(uri: Uri): ByteArray? {
        return try {
            contentResolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArrayOutputStream()
                input.copyTo(buffer, 8192)
                buffer.toByteArray()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error reading URI: ${e.message}")
            null
        }
    }

    companion object {
        private const val TAG = "ShareReceiver"
    }
}
