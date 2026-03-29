package com.raylink.network

import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.*
import java.util.concurrent.TimeUnit

class RayLinkWebSocketClient(
    private val certificateManager: CertificateManager
) {

    private var webSocket: WebSocket? = null
    private var client: OkHttpClient? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val _messages = MutableSharedFlow<Message>(replay = 0, extraBufferCapacity = 64)
    val messages: SharedFlow<Message> = _messages

    var onConnected: (() -> Unit)? = null
    var onDisconnected: (() -> Unit)? = null

    private var reconnectJob: Job? = null
    private var reconnectDelay = INITIAL_RECONNECT_DELAY
    private var targetHost: String? = null
    private var targetPort: Int? = null

    fun connect(host: String, port: Int) {
        targetHost = host
        targetPort = port
        reconnectDelay = INITIAL_RECONNECT_DELAY
        doConnect(host, port)
    }

    private fun doConnect(host: String, port: Int) {
        disconnect(reconnect = false)

        val sslContext = certificateManager.createTrustAllSslContext()

        client = OkHttpClient.Builder()
            .sslSocketFactory(sslContext.socketFactory, object : javax.net.ssl.X509TrustManager {
                override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>?, authType: String?) {}
                override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>?, authType: String?) {}
                override fun getAcceptedIssuers(): Array<java.security.cert.X509Certificate> = arrayOf()
            })
            .hostnameVerifier { _, _ -> true } // We verify via pairing, not hostname
            .pingInterval(30, TimeUnit.SECONDS)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MINUTES) // No timeout for WebSocket reads
            .build()

        val request = Request.Builder()
            .url("wss://$host:$port")
            .build()

        webSocket = client?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "Connected to $host:$port")
                reconnectDelay = INITIAL_RECONNECT_DELAY
                onConnected?.invoke()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val message = Protocol.parse(text) ?: return
                scope.launch {
                    _messages.emit(message)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "Connection closing: $code $reason")
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "Connection closed: $code $reason")
                onDisconnected?.invoke()
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Connection failed: ${t.message}")
                onDisconnected?.invoke()
                scheduleReconnect()
            }
        })
    }

    fun send(message: Message) {
        val json = Protocol.serialize(message)
        webSocket?.send(json)
    }

    fun sendClipboard(content: String) {
        send(Protocol.createMessage(
            MessageType.CLIPBOARD_UPDATE,
            mapOf("content" to content, "contentType" to "text")
        ))
    }

    fun sendPairRequest(deviceName: String, deviceId: String, certificate: String) {
        send(Protocol.createMessage(
            MessageType.PAIR_REQUEST,
            mapOf(
                "deviceName" to deviceName,
                "deviceId" to deviceId,
                "certificate" to certificate
            )
        ))
    }

    fun sendPairAccept(deviceName: String, deviceId: String, certificate: String) {
        send(Protocol.createMessage(
            MessageType.PAIR_ACCEPT,
            mapOf(
                "deviceName" to deviceName,
                "deviceId" to deviceId,
                "certificate" to certificate
            )
        ))
    }

    fun disconnect(reconnect: Boolean = false) {
        if (!reconnect) {
            reconnectJob?.cancel()
            reconnectJob = null
        }
        webSocket?.close(1000, "Client disconnect")
        webSocket = null
        client?.dispatcher?.executorService?.shutdown()
        client = null
    }

    fun isConnected(): Boolean {
        return webSocket != null
    }

    private fun scheduleReconnect() {
        val host = targetHost ?: return
        val port = targetPort ?: return

        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(reconnectDelay)
            reconnectDelay = (reconnectDelay * 2).coerceAtMost(MAX_RECONNECT_DELAY)
            Log.d(TAG, "Reconnecting to $host:$port...")
            doConnect(host, port)
        }
    }

    fun destroy() {
        scope.cancel()
        disconnect(reconnect = false)
    }

    companion object {
        private const val TAG = "WebSocketClient"
        private const val INITIAL_RECONNECT_DELAY = 1000L // 1 second
        private const val MAX_RECONNECT_DELAY = 30000L // 30 seconds
    }
}
