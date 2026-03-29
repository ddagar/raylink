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

    override fun onCreate() {
        super.onCreate()
        certManager = CertificateManager(this)
        wsClient = RayLinkWebSocketClient(certManager)
        discovery = MdnsDiscovery(this)

        createNotificationChannel()
        startForeground(NOTIFICATION_ID, createNotification("Searching for Mac..."))

        setupMessageHandling()
        startDiscovery()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scope.cancel()
        wsClient.destroy()
        discovery.stopDiscovery()
        super.onDestroy()
    }

    private fun setupMessageHandling() {
        wsClient.onConnected = {
            val deviceId = certManager.getOrCreateDeviceId()
            val deviceName = Build.MODEL

            // Send pair request
            wsClient.sendPairRequest(
                deviceName = deviceName,
                deviceId = deviceId,
                certificate = "" // TODO: send actual cert PEM
            )
        }

        wsClient.onDisconnected = {
            connectedDeviceName = null
            updateNotification("Disconnected — searching...")
        }

        scope.launch {
            wsClient.messages.collectLatest { message ->
                handleMessage(message)
            }
        }
    }

    private fun handleMessage(message: Message) {
        when (message.type) {
            MessageType.PAIR_ACCEPT -> {
                val deviceName = message.body["deviceName"] ?: "Mac"
                val deviceId = message.body["deviceId"] ?: ""
                connectedDeviceName = deviceName

                // Save trusted device
                val cert = message.body["certificate"] ?: ""
                if (cert.isNotEmpty()) {
                    certManager.saveTrustedDevice(deviceId, cert)
                }

                updateNotification("Connected to $deviceName")
                Log.d(TAG, "Paired with $deviceName ($deviceId)")
            }

            MessageType.PAIR_REJECT -> {
                Log.d(TAG, "Pairing rejected")
                updateNotification("Pairing rejected")
            }

            MessageType.CLIPBOARD_UPDATE -> {
                val content = message.body["content"] ?: return
                setDeviceClipboard(content)
                Log.d(TAG, "Clipboard received: ${content.take(50)}...")
            }

            MessageType.CLIPBOARD_REQUEST -> {
                val clipboard = getDeviceClipboard()
                if (clipboard != null) {
                    wsClient.sendClipboard(clipboard)
                }
            }

            MessageType.FILE_OFFER -> {
                // Auto-accept file transfers
                val transferId = message.body["transferId"] ?: return
                val fileName = message.body["fileName"] ?: "unknown"
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

    private fun setDeviceClipboard(content: String) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText("RayLink", content)
        clipboard.setPrimaryClip(clip)
    }

    private fun getDeviceClipboard(): String? {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        return clipboard.primaryClip?.getItemAt(0)?.text?.toString()
    }

    fun sendClipboard(content: String) {
        wsClient.sendClipboard(content)
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
