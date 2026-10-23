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
    val url: String = "",
    val repeat: String = "",
    val repeatUntil: String = "",
    val endDate: String = "",
    val attendees: List<Attendee> = emptyList(),
    val invite: Invite? = null,
    /** `null` — напоминание по умолчанию из настроек, пусто — не напоминать. */
    val reminders: List<Int>? = null,
)

/**
 * Дополнительные поля события. `null` — «не трогать» (при правке) или «по умолчанию» (при создании).
 * [reminderTouched] отделяет «напоминание по умолчанию» (reminder = null) от «не менять».
 */
data class EventExtras(
    val subtitle: String? = null,
    val repeat: String? = null,
    val attendees: List<String>? = null,
    val url: String? = null,
    val reminder: Int? = null,
    val reminderTouched: Boolean = false,
)

@Serializable
data class Attendee(val username: String = "", val name: String = "", val status: String = "pending")

@Serializable
data class Invite(val from: User, val status: String = "pending")

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
    val owner: User? = null,
    val members: List<User> = emptyList(),
    val role: String = "",
    val estimate: Int = 0,
    val category: String = "",
)

/** Поля новой задачи, как в форме на сайте. */
data class NewTask(
    val title: String,
    val note: String = "",
    val kind: String = "task",
    val category: String = "",
    val estimate: Int = 0,
    val due: String = "",
    val cadence: String = "",
    val members: List<String> = emptyList(),
)

@Serializable
data class SearchResult(val events: List<Event> = emptyList(), val tasks: List<Task> = emptyList())

@Serializable
data class AppNotification(
    val id: Int,
    val text: String = "",
    val from: User? = null,
    val date: String = "",
    val read: Boolean = false,
    val createdAt: String = "",
)

@Serializable
data class AuthSession(
    val id: String,
    val label: String = "",
    val createdAt: String = "",
    val lastSeen: String = "",
    val current: Boolean = false,
)

@Serializable
data class Memory(
    val id: Int,
    val kind: String = "about",
    val text: String = "",
    val date: String = "",
    val source: String = "user",
    val confirmed: Boolean = false,
)

@Serializable
data class SuggestionAction(
    val type: String = "",
    val title: String = "",
    val date: String = "",
    val start: Int = 0,
    val end: Int = 0,
    val badge: String = "",
    val due: String = "",
    val prompt: String = "",
)

@Serializable
data class Suggestion(
    val id: Int,
    val kind: String = "",
    val title: String = "",
    val body: String = "",
    val action: SuggestionAction = SuggestionAction(),
    val status: String = "pending",
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

@Serializable
data class Integration(
    val id: String,
    val kind: String = "ics",
    val name: String = "",
    val account: String = "",
    val badge: String = "routine",
    val writable: Boolean = false,
    val primary: Boolean = false,
    val lastSync: String = "",
    val lastError: String = "",
)

@Serializable
data class IntegrationProviders(val google: Boolean = false, val outlook: Boolean = false)

@Serializable
data class IntegrationsInfo(
    val items: List<Integration> = emptyList(),
    val providers: IntegrationProviders = IntegrationProviders(),
)

@Serializable
data class CalDavCalendar(val url: String, val name: String = "", val writable: Boolean = false)

@Serializable
data class CalDavFound(val calendars: List<CalDavCalendar> = emptyList())

@Serializable
data class ProtectedBlock(
    val title: String = "",
    val start: Int = 0,
    val end: Int = 0,
    val days: List<Int> = emptyList(),
)

@Serializable
data class Profile(
    val wakeUp: Int = 7 * 60,
    val bedTime: Int = 23 * 60,
    val workStart: Int = 9 * 60,
    val workEnd: Int = 18 * 60,
    val workDays: List<Int> = listOf(1, 2, 3, 4, 5),
    val focus: String = "none",
    val meetingMinutes: Int = 60,
    val bufferMinutes: Int = 0,
    val protected: List<ProtectedBlock> = emptyList(),
    val tone: String = "brief",
    val address: String = "ty",
    val about: String = "",
    val memory: Boolean = true,
    val proactive: Int = 2,
    val muted: List<String> = emptyList(),
    val onboarded: Boolean = false,
)

@Serializable
data class Person(
    val id: Int,
    val name: String = "",
    val aliases: List<String> = emptyList(),
    val relation: String = "",
    val place: String = "",
    val meetingMinutes: Int = 0,
    val birthday: String = "",
    val notes: String = "",
    val username: String = "",
)

@Serializable
data class FeedPath(val path: String = "")
