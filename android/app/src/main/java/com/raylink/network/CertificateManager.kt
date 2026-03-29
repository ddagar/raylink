package com.raylink.network

import android.content.Context
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.Date
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import org.bouncycastle.x509.X509V3CertificateGenerator
import javax.security.auth.x500.X500Principal

class CertificateManager(private val context: Context) {

    private val certFile get() = File(context.filesDir, "device_cert.pem")
    private val keyFile get() = File(context.filesDir, "device_key.pem")
    private val trustedDir get() = File(context.filesDir, "trusted_certs").also { it.mkdirs() }

    fun getOrCreateDeviceId(): String {
        val prefs = context.getSharedPreferences("raylink", Context.MODE_PRIVATE)
        var deviceId = prefs.getString("device_id", null)
        if (deviceId == null) {
            deviceId = java.util.UUID.randomUUID().toString().replace("-", "").take(32)
            prefs.edit().putString("device_id", deviceId).apply()
        }
        return deviceId
    }

    fun computeFingerprint(certPem: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(certPem.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    fun computeVerificationCode(certA: String, certB: String): String {
        val sorted = listOf(certA, certB).sorted()
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(sorted[0].toByteArray())
        digest.update(sorted[1].toByteArray())
        val hex = digest.digest().joinToString("") { "%02x".format(it) }
        val num = hex.take(8).toLong(16) % 1000000
        return num.toString().padStart(6, '0')
    }

    fun isTrustedDevice(deviceId: String): Boolean {
        return File(trustedDir, "$deviceId.pem").exists()
    }

    fun saveTrustedDevice(deviceId: String, certPem: String) {
        File(trustedDir, "$deviceId.pem").writeText(certPem)
    }

    fun removeTrustedDevice(deviceId: String) {
        File(trustedDir, "$deviceId.pem").delete()
    }

    /**
     * Create a TrustManager that accepts all certificates.
     * We handle trust verification at the application layer via pairing.
     */
    fun createTrustAllSslContext(): SSLContext {
        val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>?, authType: String?) {}
            override fun checkServerTrusted(chain: Array<X509Certificate>?, authType: String?) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        })

        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, trustAllCerts, SecureRandom())
        return sslContext
    }
}
