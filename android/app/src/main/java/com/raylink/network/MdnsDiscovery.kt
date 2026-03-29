package com.raylink.network

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log

data class DiscoveredService(
    val name: String,
    val host: String,
    val port: Int,
    val deviceId: String?,
    val deviceName: String?
)

class MdnsDiscovery(context: Context) {

    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val discovered = mutableListOf<DiscoveredService>()

    var onServiceFound: ((DiscoveredService) -> Unit)? = null
    var onServiceLost: ((String) -> Unit)? = null

    fun startDiscovery() {
        if (discoveryListener != null) return

        discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Discovery start failed: $errorCode")
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Discovery stop failed: $errorCode")
            }

            override fun onDiscoveryStarted(serviceType: String) {
                Log.d(TAG, "Discovery started for $serviceType")
            }

            override fun onDiscoveryStopped(serviceType: String) {
                Log.d(TAG, "Discovery stopped")
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                Log.d(TAG, "Service found: ${serviceInfo.serviceName}")
                resolveService(serviceInfo)
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                Log.d(TAG, "Service lost: ${serviceInfo.serviceName}")
                onServiceLost?.invoke(serviceInfo.serviceName)
                discovered.removeAll { it.name == serviceInfo.serviceName }
            }
        }

        nsdManager.discoverServices(
            Protocol.MDNS_SERVICE_TYPE,
            NsdManager.PROTOCOL_DNS_SD,
            discoveryListener
        )
    }

    fun stopDiscovery() {
        discoveryListener?.let {
            try {
                nsdManager.stopServiceDiscovery(it)
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping discovery: ${e.message}")
            }
            discoveryListener = null
        }
    }

    fun getDiscoveredServices(): List<DiscoveredService> = discovered.toList()

    private fun resolveService(serviceInfo: NsdServiceInfo) {
        nsdManager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Resolve failed for ${info.serviceName}: $errorCode")
            }

            override fun onServiceResolved(info: NsdServiceInfo) {
                val host = info.host?.hostAddress ?: return
                val port = info.port

                // Extract TXT records
                val attributes = info.attributes
                val deviceId = attributes["deviceId"]?.let { String(it) }
                val deviceName = attributes["deviceName"]?.let { String(it) }

                val service = DiscoveredService(
                    name = info.serviceName,
                    host = host,
                    port = port,
                    deviceId = deviceId,
                    deviceName = deviceName
                )

                discovered.add(service)
                Log.d(TAG, "Resolved: $host:$port (${deviceName ?: "unknown"})")
                onServiceFound?.invoke(service)
            }
        })
    }

    companion object {
        private const val TAG = "MdnsDiscovery"
    }
}
