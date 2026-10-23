package app.calendar.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

internal val apiJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
    explicitNulls = false
    encodeDefaults = false
}

class ApiException(val status: Int, message: String) : Exception(message)

@Serializable
data class User(
    val id: Long,
    val username: String,
    val name: String = "",
    val timeZone: String = "",
)

@Serializable
data class SessionResponse(val token: String, val user: User)

@Serializable
data class Event(
    val id: String,
    val date: String = "",
    val title: String = "",
    val subtitle: String = "",
    val start: Int = 0,
    val end: Int = 0,
    val badge: String = "routine",
    val readOnly: Boolean = false,
    val allDay: Boolean = false,
    val notes: String = "",
    val repeat: String = "",
)

@Serializable
data class Task(
    val id: String,
    val title: String = "",
    val subtitle: String = "",
    val kind: String = "task",
    val done: Boolean = false,
    val due: String = "",
    val cadence: String = "",
    val checks: List<String> = emptyList(),
)

@Serializable
data class ChatMessage(
    val id: Long = 0,
    val role: String = "ai",
    val text: String = "",
)

@Serializable
data class ConfirmCard(
    val id: String,
    val title: String,
    val detail: String = "",
    val button: String = "Да",
    val date: String = "",
)

@Serializable
data class ConfirmResult(
    val message: ChatMessage? = null,
    val ok: Boolean = false,
    val date: String = "",
)

@Serializable
data class WeekDayInsight(
    val date: String = "",
    val minutes: Int = 0,
    val events: Int = 0,
)

@Serializable
data class WeekInsights(
    val start: String = "",
    val days: List<WeekDayInsight> = emptyList(),
    val byBadge: Map<String, Int> = emptyMap(),
    val minutes: Int = 0,
    val average: Int = 0,
    val focus: Int = 0,
    val done: Int = 0,
    val busiest: String? = null,
)

@Serializable
private data class ErrorBody(val error: String = "")

internal fun errorText(body: String, status: Int): String {
    val parsed = runCatching { apiJson.decodeFromString<ErrorBody>(body).error }.getOrNull()
    if (!parsed.isNullOrBlank()) return parsed
    return if (status == 0) "Нет соединения с сервером" else "Ошибка $status"
}
