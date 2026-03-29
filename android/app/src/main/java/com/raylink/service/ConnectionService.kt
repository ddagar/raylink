package com.raylink.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.raylink.R
import com.raylink.network.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest

class ConnectionService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var wsClient: RayLinkWebSocketClient
    private lateinit var discovery: MdnsDiscovery
    private lateinit var certManager: CertificateManager

    private var connectedDeviceName: String? = null
    private var connectedDeviceId: String? = null
    private var isPaired = false

    // Suppress echo: when we receive clipboard from Mac, don't send it back.
    // Uses content + timestamp to avoid false suppression after the echo window.
    private var lastReceivedClipboard: String? = null
    private var lastReceivedTime: Long = 0
    private val echoWindowMs = 2000L // suppress echoes within 2 seconds of receiving

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
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
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

            // Always send pair.request — the Mac will auto-accept if already paired.
            // This is simpler than tracking pairing state across reconnects,
            // and the Mac handles it efficiently (immediate accept, no user prompt).
            wsClient.sendPairRequest(
                deviceName = deviceName,
                deviceId = deviceId,
                certificate = "" // TLS trust handled at connection level
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

    /**
     * Wire the ClipboardAccessibilityService callback to send clipboard
     * changes over WebSocket to the Mac.
     */
    private fun setupClipboardMonitoring() {
        ClipboardAccessibilityService.onClipboardChanged = { content ->
            if (isPaired && wsClient.isConnected()) {
                // Don't echo back clipboard content we just received from Mac
                // Only suppress within the echo window to avoid false suppression
                val isEcho = content == lastReceivedClipboard &&
                    (System.currentTimeMillis() - lastReceivedTime) < echoWindowMs
                if (!isEcho) {
                    Log.d(TAG, "Sending clipboard to Mac: ${content.take(50)}...")
                    wsClient.sendClipboard(content)
                } else {
                    Log.d(TAG, "Suppressing clipboard echo")
                }
            }
        }
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

                // Save trusted device
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

                // Send current clipboard to Mac on connection
                sendClipboardConnect()
            }

            MessageType.PAIR_REJECT -> {
                isPaired = false
                Log.d(TAG, "Pairing rejected")
                updateNotification("Pairing rejected")
            }

            // Handle both clipboard.update and clipboard.connect
            MessageType.CLIPBOARD_UPDATE, MessageType.CLIPBOARD_CONNECT -> {
                val content = message.bodyString("content") ?: return
                lastReceivedClipboard = content
                lastReceivedTime = System.currentTimeMillis()
                setDeviceClipboard(content)
                Log.d(TAG, "Clipboard received from Mac: ${content.take(50)}...")
            }

            MessageType.CLIPBOARD_REQUEST -> {
                val clipboard = getDeviceClipboard()
                if (clipboard != null) {
                    wsClient.sendClipboard(clipboard)
                }
            }

            MessageType.FILE_OFFER -> {
                val transferId = message.bodyString("transferId") ?: return
                val fileName = message.bodyString("fileName") ?: "unknown"
                Log.d(TAG, "Incoming file: $fileName")
                wsClient.send(Protocol.createMessage(
                    MessageType.FILE_ACCEPT,
                    mapOf("transferId" to transferId)
                ))
                // TODO: accumulate file chunks and save
            }

            MessageType.PING -> {
                wsClient.send(Protocol.createMessage(MessageType.PONG))
            }
        }
    }

    /**
     * Send the current device clipboard to the Mac when first connecting.
     */
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
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("RayLink")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
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

        fun start(context: Context) {
            val intent = Intent(context, ConnectionService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, ConnectionService::class.java)
            context.stopService(intent)
        }
    }
}
