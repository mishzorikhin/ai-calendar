package app.calendar.api

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

sealed interface ChatFrame {
    data object Opened : ChatFrame
    data class Delta(val text: String) : ChatFrame
    data class Tool(val name: String, val status: String, val detail: String) : ChatFrame
    data class Confirm(val card: ConfirmCard) : ChatFrame
    data class Memory(val lines: List<String>) : ChatFrame
    data object Done : ChatFrame
    data class Failure(val message: String) : ChatFrame
}

/**
 * Забирает готовые SSE-события из накопленного текста. Хвост без пустой строки
 * остаётся: кадр мог прийти разрезанным между чанками.
 */
fun consumeSse(buffer: String): Pair<List<String>, String> {
    val events = mutableListOf<String>()
    val normalized = buffer.replace("\r\n", "\n")
    var rest = normalized
    while (true) {
        val cut = rest.indexOf("\n\n")
        if (cut < 0) break
        val payload = rest.substring(0, cut)
            .lineSequence()
            .filter { it.startsWith("data:") }
            .joinToString("\n") { it.removePrefix("data:").trim() }
        if (payload.isNotEmpty()) events += payload
        rest = rest.substring(cut + 2)
    }
    return events to rest
}

fun parseChatFrame(raw: String): ChatFrame? {
    val obj = runCatching { apiJson.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return null
    val type = obj.string("type") ?: return null
    return when (type) {
        "delta" -> ChatFrame.Delta(obj.string("text").orEmpty())
        "tool" -> ChatFrame.Tool(
            name = obj.string("name").orEmpty(),
            status = obj.string("status").orEmpty(),
            detail = obj.string("detail").orEmpty(),
        )
        "confirm" -> {
            val card = obj["confirm"] ?: return null
            runCatching { apiJson.decodeFromJsonElement(ConfirmCard.serializer(), card) }
                .getOrNull()
                ?.let(ChatFrame::Confirm)
        }
        "memory" -> {
            val lines = obj["items"]?.jsonArray.orEmpty().mapNotNull { item ->
                item.jsonObject.string("text")?.takeIf { it.isNotBlank() }
            }
            ChatFrame.Memory(lines)
        }
        "done" -> ChatFrame.Done
        "error" -> ChatFrame.Failure(obj.string("message") ?: "Ответ оборвался")
        else -> null
    }
}

private fun JsonObject.string(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull
