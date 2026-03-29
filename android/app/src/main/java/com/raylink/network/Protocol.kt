package com.raylink.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import java.util.UUID

@Serializable
data class Message(
    val id: String = UUID.randomUUID().toString(),
    val type: String,
    val timestamp: Long = System.currentTimeMillis(),
    val body: Map<String, JsonElement> = emptyMap()
) {
    /**
     * Get a body value as a string. Handles JSON strings, numbers, and booleans.
     * Returns the string representation of the value, or null if the key is missing.
     */
    fun bodyString(key: String): String? {
        val element = body[key] ?: return null
        return try {
            // contentOrNull works for string primitives
            element.jsonPrimitive.contentOrNull
                // Fall back to the raw content for numbers/booleans
                ?: element.jsonPrimitive.content
        } catch (e: Exception) {
            null
        }
    }

    /** Get a body value as a boolean. Handles both JSON booleans and string "true"/"false". */
    fun bodyBoolean(key: String): Boolean {
        val element = body[key] ?: return false
        return try {
            element.jsonPrimitive.booleanOrNull
                ?: (element.jsonPrimitive.contentOrNull == "true")
        } catch (e: Exception) {
            false
        }
    }

    /** Get a body value as a Long. Handles both JSON numbers and numeric strings. */
    fun bodyLong(key: String): Long {
        val element = body[key] ?: return 0L
        return try {
            element.jsonPrimitive.longOrNull
                ?: element.jsonPrimitive.contentOrNull?.toLongOrNull()
                ?: 0L
        } catch (e: Exception) {
            0L
        }
    }
}

object MessageType {
    const val PAIR_REQUEST = "pair.request"
    const val PAIR_ACCEPT = "pair.accept"
    const val PAIR_REJECT = "pair.reject"
    const val CLIPBOARD_UPDATE = "clipboard.update"
    const val CLIPBOARD_CONNECT = "clipboard.connect"
    const val CLIPBOARD_REQUEST = "clipboard.request"
    const val FILE_OFFER = "file.offer"
    const val FILE_ACCEPT = "file.accept"
    const val FILE_REJECT = "file.reject"
    const val FILE_CHUNK = "file.chunk"
    const val PING = "ping"
    const val PONG = "pong"
}

object Protocol {
    const val WEBSOCKET_PORT = 18734
    const val MDNS_SERVICE_TYPE = "_raylink._tcp."
    const val PROTOCOL_VERSION = 1
    const val FILE_CHUNK_SIZE = 64 * 1024 // 64KB

    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun createMessage(type: String, body: Map<String, String> = emptyMap()): Message {
        val jsonBody = body.mapValues { (_, v) -> JsonPrimitive(v) as JsonElement }
        return Message(type = type, body = jsonBody)
    }

    fun serialize(message: Message): String {
        return json.encodeToString(Message.serializer(), message)
    }

    fun parse(raw: String): Message? {
        return try {
            json.decodeFromString(Message.serializer(), raw)
        } catch (e: Exception) {
            null
        }
    }
}
