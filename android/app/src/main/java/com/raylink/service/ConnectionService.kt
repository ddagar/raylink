package com.raylink.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.util.Base64
import android.util.Log
import com.raylink.R
import com.raylink.network.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import java.io.File
import java.io.FileOutputStream

class ConnectionService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var wsClient: RayLinkWebSocketClient
    private lateinit var discovery: MdnsDiscovery
    private lateinit var certManager: CertificateManager

    private var connectedDeviceName: String? = null
    private var connectedDeviceId: String? = null
    private var isPaired = false

    // Suppress echo: when we receive clipboard from Mac, don't send it back.
    private var lastReceivedClipboard: String? = null
    private var lastReceivedTime: Long = 0
    private val echoWindowMs = 2000L

    // Track last sent clipboard to avoid duplicates
    private var lastSentClipboard: String? = null

    // File receive state: transferId -> accumulated chunks
    private val incomingFiles = mutableMapOf<String, IncomingFile>()

    private data class IncomingFile(
        val fileName: String,
        val fileSize: Long,
        val mimeType: String,
        val chunks: MutableList<ByteArray> = mutableListOf(),
        var receivedBytes: Long = 0
    )

    override fun onCreate() {
        super.onCreate()
        certManager = CertificateManager(this)
        wsClient = RayLinkWebSocketClient(certManager)
        discovery = MdnsDiscovery(this)

        createNotificationChannel()
        startForeground(NOTIFICATION_ID, createNotification("Searching for Mac..."))

        setupMessageHandling()
        setupClipboardMonitoring()
        startDiscovery()

        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Handle "Send Clipboard" action from notification
        if (intent?.action == ACTION_SEND_CLIPBOARD) {
            sendCurrentClipboard()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        instance = null
        ClipboardAccessibilityService.onClipboardChanged = null
        scope.cancel()
        wsClient.destroy()
        discovery.stopDiscovery()
        super.onDestroy()
    }

    private fun setupMessageHandling() {
        wsClient.onConnected = {
            val deviceId = certManager.getOrCreateDeviceId()
            val deviceName = Build.MODEL

            wsClient.sendPairRequest(
                deviceName = deviceName,
                deviceId = deviceId,
                certificate = ""
            )
        }

        wsClient.onDisconnected = {
            connectedDeviceName = null
            connectedDeviceId = null
            isPaired = false
            updateNotification("Disconnected — searching...")
        }

        scope.launch {
            wsClient.messages.collectLatest { message ->
                handleMessage(message)
            }
        }
    }

    private fun setupClipboardMonitoring() {
        // Method 1: Accessibility Service (works in background on some devices)
        ClipboardAccessibilityService.onClipboardChanged = { content ->
            trySendClipboard(content)
        }

        // Method 2: ClipboardManager listener (works when service has focus)
        scope.launch(Dispatchers.Main) {
            try {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.addPrimaryClipChangedListener {
                    try {
                        val clip = clipboard.primaryClip
                        if (clip != null && clip.itemCount > 0) {
                            val content = clip.getItemAt(0).text?.toString()
                            if (content != null) {
                                trySendClipboard(content)
                            }
                        }
                    } catch (e: Exception) {
                        Log.d(TAG, "ClipChangedListener: ${e.message}")
                    }
                }
                Log.d(TAG, "ClipboardManager listener registered")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to register clipboard listener: ${e.message}")
            }
        }

        // Method 3: Polling fallback — Samsung OneUI blocks background clipboard
        // reads from accessibility services and clip listeners. Poll every 1s
        // using the accessibility service context (which has clipboard read access).
        scope.launch {
            var lastPolledContent: String? = null
            while (true) {
                delay(1000)
                if (!isPaired || !wsClient.isConnected()) continue
                try {
                    // Try reading from accessibility service context first (has elevated access)
                    val a11y = ClipboardAccessibilityService.instance
                    val clipManager = if (a11y != null) {
                        a11y.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    } else {
                        getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    }
                    val clip = clipManager?.primaryClip
                    if (clip != null && clip.itemCount > 0) {
                        val content = clip.getItemAt(0).text?.toString()
                        if (content != null && content != lastPolledContent) {
                            lastPolledContent = content
                            trySendClipboard(content)
                        }
                    }
                } catch (_: Exception) {
                    // Clipboard read failed — expected on some devices
                }
            }
        }
    }

    /**
     * Attempt to send clipboard content to Mac.
     * Handles echo suppression and deduplication.
     */
    private fun trySendClipboard(content: String) {
        if (!isPaired || !wsClient.isConnected()) return

        // Don't echo back what we just received from Mac
        val isEcho = content == lastReceivedClipboard &&
            (System.currentTimeMillis() - lastReceivedTime) < echoWindowMs
        if (isEcho) {
            Log.d(TAG, "Suppressing clipboard echo")
            return
        }

        // Don't send duplicates
        if (content == lastSentClipboard) return

        lastSentClipboard = content
        Log.d(TAG, "Sending clipboard to Mac: ${content.take(50)}...")
        wsClient.sendClipboard(content)
    }

    /**
     * Read current clipboard and send to Mac. Called from notification action.
     */
    private fun sendCurrentClipboard() {
        if (!isPaired || !wsClient.isConnected()) {
            Log.w(TAG, "Cannot send clipboard: not connected")
            return
        }
        scope.launch(Dispatchers.Main) {
            try {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = clipboard.primaryClip
                if (clip != null && clip.itemCount > 0) {
                    val content = clip.getItemAt(0).text?.toString()
                    if (content != null) {
                        lastSentClipboard = content
                        wsClient.sendClipboard(content)
                        Log.d(TAG, "Sent clipboard from notification: ${content.take(50)}...")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to send clipboard: ${e.message}")
            }
        }
    }

    private fun startDiscovery() {
        discovery.onServiceFound = { service ->
            Log.d(TAG, "Found Mac: ${service.deviceName} at ${service.host}:${service.port}")
            if (!wsClient.isConnected()) {
                wsClient.connect(service.host, service.port)
                updateNotification("Connecting to ${service.deviceName ?: service.host}...")
            }
        }

        discovery.startDiscovery()
    }

    private fun handleMessage(message: Message) {
        when (message.type) {
            MessageType.PAIR_ACCEPT -> {
                val deviceName = message.bodyString("deviceName") ?: "Mac"
                val deviceId = message.bodyString("deviceId") ?: ""
                val wasAlreadyPaired = certManager.isTrustedDevice(deviceId)
                connectedDeviceName = deviceName
                connectedDeviceId = deviceId
                isPaired = true

                val cert = message.bodyString("certificate") ?: ""
                if (cert.isNotEmpty()) {
                    certManager.saveTrustedDevice(deviceId, cert)
                }

                if (wasAlreadyPaired) {
                    updateNotification("Reconnected to $deviceName")
                    Log.d(TAG, "Reconnected to $deviceName ($deviceId)")
                } else {
                    updateNotification("Connected to $deviceName")
                    Log.d(TAG, "Paired with $deviceName ($deviceId)")
                }

                sendClipboardConnect()
            }

            MessageType.PAIR_REJECT -> {
                isPaired = false
                Log.d(TAG, "Pairing rejected")
                updateNotification("Pairing rejected")
            }

            MessageType.CLIPBOARD_UPDATE, MessageType.CLIPBOARD_CONNECT -> {
                val content = message.bodyString("content") ?: return
                lastReceivedClipboard = content
                lastReceivedTime = System.currentTimeMillis()
                setDeviceClipboard(content)
                Log.d(TAG, "Clipboard received from Mac: ${content.take(50)}...")
            }

            MessageType.CLIPBOARD_REQUEST -> {
                sendCurrentClipboard()
            }

            MessageType.FILE_OFFER -> {
                val transferId = message.bodyString("transferId") ?: return
                val fileName = message.bodyString("fileName") ?: "unknown"
                val fileSize = message.bodyLong("fileSize")
                val mimeType = message.bodyString("mimeType") ?: "application/octet-stream"

                Log.d(TAG, "Incoming file: $fileName ($fileSize bytes)")

                incomingFiles[transferId] = IncomingFile(fileName, fileSize, mimeType)

                wsClient.send(Protocol.createMessage(
                    MessageType.FILE_ACCEPT,
                    mapOf("transferId" to transferId)
                ))

                updateNotification("Receiving $fileName...")
            }

            MessageType.FILE_CHUNK -> {
                val transferId = message.bodyString("transferId") ?: return
                val data = message.bodyString("data") ?: return
                val isLast = message.bodyBoolean("isLast")

                val incoming = incomingFiles[transferId] ?: return
                val chunk = Base64.decode(data, Base64.DEFAULT)
                incoming.chunks.add(chunk)
                incoming.receivedBytes += chunk.size.toLong()

                if (isLast) {
                    saveReceivedFile(transferId, incoming)
                }
            }

            MessageType.PING -> {
                wsClient.send(Protocol.createMessage(MessageType.PONG))
            }
        }
    }

    private fun saveReceivedFile(transferId: String, incoming: IncomingFile) {
        scope.launch {
            try {
                // Save to public Downloads via MediaStore (visible in Files app)
                val resolver = contentResolver
                val contentValues = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.Downloads.DISPLAY_NAME, incoming.fileName)
                    put(android.provider.MediaStore.Downloads.MIME_TYPE, incoming.mimeType)
                    put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
                }

                val uri = resolver.insert(
                    android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    contentValues
                )

                if (uri != null) {
                    resolver.openOutputStream(uri)?.use { out ->
                        for (chunk in incoming.chunks) {
                            out.write(chunk)
                        }
                    }

                    // Mark as complete so it's visible to other apps
                    contentValues.clear()
                    contentValues.put(android.provider.MediaStore.Downloads.IS_PENDING, 0)
                    resolver.update(uri, contentValues, null, null)

                    Log.d(TAG, "File saved to Downloads: ${incoming.fileName}")
                    updateNotification("Received ${incoming.fileName}")
                } else {
                    Log.e(TAG, "Failed to create MediaStore entry")
                    updateNotification("Failed to save ${incoming.fileName}")
                }

                incomingFiles.remove(transferId)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to save file: ${e.message}")
                updateNotification("Failed to save ${incoming.fileName}")
                incomingFiles.remove(transferId)
            }
        }
    }

    private fun getUniqueFile(dir: File, fileName: String): File {
        var file = File(dir, fileName)
        var counter = 1
        while (file.exists()) {
            val ext = if (fileName.contains(".")) ".${fileName.substringAfterLast(".")}" else ""
            val base = if (ext.isNotEmpty()) fileName.removeSuffix(ext) else fileName
            file = File(dir, "$base ($counter)$ext")
            counter++
        }
        return file
    }

    private fun sendClipboardConnect() {
        val clipboard = getDeviceClipboard()
        if (clipboard != null) {
            wsClient.send(Protocol.createMessage(
                MessageType.CLIPBOARD_CONNECT,
                mapOf("content" to clipboard, "contentType" to "text")
            ))
            Log.d(TAG, "Sent clipboard.connect to Mac")
        }
    }

    private fun setDeviceClipboard(content: String) {
        scope.launch(Dispatchers.Main) {
            try {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = ClipData.newPlainText("RayLink", content)
                clipboard.setPrimaryClip(clip)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to set clipboard: ${e.message}")
            }
        }
    }

    private fun getDeviceClipboard(): String? {
        return try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.primaryClip?.getItemAt(0)?.text?.toString()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read clipboard: ${e.message}")
            null
        }
    }

    /**
     * Send a file to the Mac. Called from ShareReceiverActivity.
     */
    fun doSendFile(transferId: String, fileName: String, mimeType: String, data: ByteArray) {
        if (!isPaired || !wsClient.isConnected()) {
            Log.w(TAG, "Cannot send file: not connected")
            return
        }

        wsClient.send(Protocol.createMessage(
            MessageType.FILE_OFFER,
            mapOf(
                "transferId" to transferId,
                "fileName" to fileName,
                "fileSize" to data.size.toString(),
                "mimeType" to mimeType
            )
        ))

        scope.launch {
            val chunkSize = Protocol.FILE_CHUNK_SIZE
            var offset = 0
            while (offset < data.size) {
                val end = minOf(offset + chunkSize, data.size)
                val chunk = data.copyOfRange(offset, end)
                val isLast = end >= data.size

                wsClient.send(Protocol.createMessage(
                    MessageType.FILE_CHUNK,
                    mapOf(
                        "transferId" to transferId,
                        "data" to Base64.encodeToString(chunk, Base64.NO_WRAP),
                        "offset" to offset.toString(),
                        "isLast" to isLast.toString()
                    )
                ))

                offset = end
            }
            Log.d(TAG, "File sent: $fileName (${data.size} bytes)")
        }
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.notification_channel_description)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun createNotification(text: String): Notification {
        // "Send Clipboard" action intent
        val sendClipIntent = Intent(this, ConnectionService::class.java).apply {
            action = ACTION_SEND_CLIPBOARD
        }
        val sendClipPending = PendingIntent.getService(
            this, 0, sendClipIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Android Link")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .addAction(
                Notification.Action.Builder(
                    null, "Send Clipboard", sendClipPending
                ).build()
            )
            .build()
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, createNotification(text))
    }

    companion object {
        private const val TAG = "ConnectionService"
        private const val CHANNEL_ID = "raylink_connection"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_SEND_CLIPBOARD = "com.raylink.SEND_CLIPBOARD"

        var instance: ConnectionService? = null
            private set

        fun start(context: Context) {
            val intent = Intent(context, ConnectionService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, ConnectionService::class.java)
            context.stopService(intent)
        }

        fun sendClipboardFromShare(content: String) {
            instance?.let {
                if (it.isPaired && it.wsClient.isConnected()) {
                    it.wsClient.sendClipboard(content)
                }
            }
        }

        fun sendFileFromShare(transferId: String, fileName: String, mimeType: String, data: ByteArray) {
            instance?.doSendFile(transferId, fileName, mimeType, data)
        }
    }
}
