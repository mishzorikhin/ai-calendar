package app.calendar.api

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObjectBuilder
import app.calendar.SessionStore
import io.ktor.client.HttpClient
import io.ktor.client.plugins.timeout
import io.ktor.client.request.header
import io.ktor.client.request.prepareRequest
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.encodeURLParameter
import io.ktor.http.isSuccess
import io.ktor.utils.io.readUTF8Line
import kotlinx.coroutines.CancellationException
import kotlinx.datetime.TimeZone
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class CalendarApi(
    private val http: HttpClient,
    private val session: SessionStore,
) {
    suspend fun health(): String {
        val body = request(HttpMethod.Get, "/api/health", null)
        return apiJson.decodeFromString<Map<String, String>>(body)["status"] ?: "ok"
    }

    suspend fun login(username: String, password: String): User =
        auth("/api/auth/login", username, password, name = null)

    suspend fun register(username: String, password: String, name: String): User =
        auth("/api/auth/register", username, password, name.ifBlank { null })

    suspend fun logout() {
        runCatching { request(HttpMethod.Post, "/api/auth/logout", buildJsonObject { }) }
        session.clear()
    }

    suspend fun me(): User = decode(request(HttpMethod.Get, "/api/me", null))

    suspend fun setTimeZone(id: String) {
        request(HttpMethod.Patch, "/api/me", buildJsonObject { put("timeZone", id) })
    }

    suspend fun events(date: String): List<Event> =
        decode(request(HttpMethod.Get, "/api/events?date=$date", null))

    suspend fun monthDots(year: Int, month: Int): Map<Int, List<String>> {
        val raw = request(HttpMethod.Get, "/api/month?year=$year&month=$month", null)
        val parsed = apiJson.decodeFromString<Map<String, List<String>>>(raw)
        return parsed.mapNotNull { (day, badges) -> day.toIntOrNull()?.let { it to badges } }.toMap()
    }

    suspend fun createEvent(
        date: String,
        title: String,
        start: Int,
        end: Int,
        badge: String,
        allDay: Boolean,
        notes: String = "",
        extras: EventExtras = EventExtras(),
    ): Event {
        val body = buildJsonObject {
            put("date", date)
            put("title", title)
            put("start", if (allDay) 0 else start)
            put("end", if (allDay) 24 * 60 else end)
            put("badge", badge)
            if (allDay) put("allDay", true)
            if (notes.isNotBlank()) put("notes", notes.trim())
            putExtras(extras, update = false)
        }
        return decode(request(HttpMethod.Post, "/api/events", body))
    }

    /** Правка события целиком: поля, которых нет в [fields], не трогаются. */
    suspend fun updateEvent(id: String, extras: EventExtras, fields: JsonObject): Event {
        val merged = JsonObject(fields + buildJsonObject { putExtras(extras, update = true) })
        return decode(request(HttpMethod.Patch, "/api/events/$id", merged))
    }

    suspend fun updateEvent(id: String, fields: JsonObject): Event = updateEvent(id, EventExtras(), fields)

    suspend fun rsvp(id: String, status: String) {
        request(HttpMethod.Post, "/api/events/$id/rsvp", buildJsonObject { put("status", status) })
    }

    suspend fun search(query: String): SearchResult =
        decode(request(HttpMethod.Get, "/api/search?q=${query.encodeURLParameter()}", null))

    suspend fun deleteEvent(id: String) {
        request(HttpMethod.Delete, "/api/events/$id", null)
    }

    suspend fun weekInsights(start: String): WeekInsights =
        decode(request(HttpMethod.Get, "/api/insights/week?start=$start", null))

    suspend fun tasks(): List<Task> = decode(request(HttpMethod.Get, "/api/tasks", null))

    suspend fun createTask(task: NewTask): Task =
        decode(request(HttpMethod.Post, "/api/tasks", buildJsonObject {
            put("title", task.title)
            if (task.note.isNotBlank()) put("subtitle", task.note)
            if (task.kind != "task") put("kind", task.kind)
            if (task.category.isNotBlank()) put("category", task.category)
            if (task.estimate > 0) put("estimate", task.estimate)
            if (task.due.isNotBlank()) put("due", task.due)
            if (task.cadence.isNotBlank()) put("cadence", task.cadence)
            if (task.members.isNotEmpty()) put("members", JsonArray(task.members.map { JsonPrimitive(it) }))
        }))

    suspend fun updateTask(id: String, fields: JsonObject): Task =
        decode(request(HttpMethod.Patch, "/api/tasks/$id", fields))

    suspend fun deleteTask(id: String) {
        request(HttpMethod.Delete, "/api/tasks/$id", null)
    }

    suspend fun setTaskDone(id: String, done: Boolean): Task =
        decode(request(HttpMethod.Patch, "/api/tasks/$id", buildJsonObject { put("done", done) }))

    suspend fun checkHabit(id: String, date: String, done: Boolean): Task {
        val body = buildJsonObject { put(if (done) "check" else "uncheck", date) }
        return decode(request(HttpMethod.Patch, "/api/tasks/$id", body))
    }

    suspend fun updateName(name: String): User =
        decode<User>(request(HttpMethod.Patch, "/api/me", buildJsonObject { put("name", name.trim()) })).also { session.saveUser(it) }

    suspend fun changePassword(current: String, next: String) {
        request(HttpMethod.Post, "/api/auth/password", buildJsonObject { put("current", current); put("next", next) })
    }

    suspend fun sessions(): List<AuthSession> = decode(request(HttpMethod.Get, "/api/auth/sessions", null))

    suspend fun deleteSession(id: String) {
        request(HttpMethod.Delete, "/api/auth/sessions/${id.encodeURLParameter()}", null)
    }

    suspend fun logoutOthers() {
        request(HttpMethod.Post, "/api/auth/logout-others", buildJsonObject { })
    }

    suspend fun deleteAccount(password: String) {
        request(HttpMethod.Delete, "/api/me", buildJsonObject { put("password", password) })
        session.clear()
    }

    suspend fun notifications(): List<AppNotification> = decode(request(HttpMethod.Get, "/api/notifications", null))

    suspend fun markNotificationsRead() {
        request(HttpMethod.Post, "/api/notifications/read", buildJsonObject { })
    }

    suspend fun memories(): List<Memory> = decode(request(HttpMethod.Get, "/api/memories", null))

    suspend fun createMemory(text: String, kind: String = "about"): Memory =
        decode(request(HttpMethod.Post, "/api/memories", buildJsonObject { put("kind", kind); put("text", text.trim()) }))

    suspend fun deleteMemory(id: Int) {
        request(HttpMethod.Delete, "/api/memories/$id", null)
    }

    suspend fun suggestions(): List<Suggestion> = decode(request(HttpMethod.Get, "/api/suggestions", null))

    suspend fun acceptSuggestion(id: Int) {
        request(HttpMethod.Post, "/api/suggestions/$id/accept", buildJsonObject { })
    }

    suspend fun dismissSuggestion(id: Int) {
        request(HttpMethod.Post, "/api/suggestions/$id/dismiss", buildJsonObject { })
    }

    suspend fun integrations(): IntegrationsInfo = decode(request(HttpMethod.Get, "/api/integrations", null))

    suspend fun discoverCalDav(url: String, username: String, password: String): List<CalDavCalendar> =
        decode<CalDavFound>(
            request(HttpMethod.Post, "/api/integrations/caldav/discover", buildJsonObject {
                put("url", url)
                put("username", username)
                put("password", password)
            }),
        ).calendars

    suspend fun createIntegration(fields: JsonObject): Integration =
        decode(request(HttpMethod.Post, "/api/integrations", fields))

    suspend fun updateIntegration(id: String, fields: JsonObject): Integration =
        decode(request(HttpMethod.Patch, "/api/integrations/$id", fields))

    suspend fun deleteIntegration(id: String) {
        request(HttpMethod.Delete, "/api/integrations/$id", null)
    }

    suspend fun syncIntegration(id: String): Integration =
        decode(request(HttpMethod.Post, "/api/integrations/$id/sync", buildJsonObject { }))

    suspend fun startOAuth(provider: String): String =
        apiJson.decodeFromString<Map<String, String>>(
            request(HttpMethod.Post, "/api/integrations/oauth/$provider/start", buildJsonObject { }),
        )["url"].orEmpty()

    /** Путь секретной ленты `.ics` или пустая строка, если лента выключена. */
    suspend fun feedPath(): String = decode<FeedPath>(request(HttpMethod.Get, "/api/feed", null)).path

    suspend fun resetFeed(): String = decode<FeedPath>(request(HttpMethod.Post, "/api/feed", buildJsonObject { })).path

    suspend fun disableFeed() {
        request(HttpMethod.Delete, "/api/feed", null)
    }

    suspend fun profile(): Profile = decode(request(HttpMethod.Get, "/api/profile", null))

    suspend fun updateProfile(fields: JsonObject): Profile =
        decode(request(HttpMethod.Patch, "/api/profile", fields))

    suspend fun people(): List<Person> = decode(request(HttpMethod.Get, "/api/people", null))

    suspend fun createPerson(fields: JsonObject): Person =
        decode(request(HttpMethod.Post, "/api/people", fields))

    suspend fun updatePerson(id: Int, fields: JsonObject): Person =
        decode(request(HttpMethod.Patch, "/api/people/$id", fields))

    suspend fun deletePerson(id: Int) {
        request(HttpMethod.Delete, "/api/people/$id", null)
    }

    suspend fun addTaskMember(taskId: String, username: String): Task =
        decode(request(HttpMethod.Post, "/api/tasks/$taskId/members", buildJsonObject { put("username", username) }))

    suspend fun removeTaskMember(taskId: String, username: String): Task =
        decode(request(HttpMethod.Delete, "/api/tasks/$taskId/members/${username.encodeURLParameter()}", null))

    suspend fun messages(): List<ChatMessage> = decode(request(HttpMethod.Get, "/api/messages", null))

    suspend fun confirms(): List<ConfirmCard> = decode(request(HttpMethod.Get, "/api/chat/confirms", null))

    suspend fun decideConfirm(id: String, accept: Boolean): ConfirmResult =
        decode(request(HttpMethod.Post, "/api/chat/confirms/$id", buildJsonObject { put("accept", accept) }))

    /**
     * Поток чата. [ChatFrame.Opened] шлётся здесь, когда сервер уже принял реплику:
     * ошибка после этого — обрыв ответа, а не «не отправилось».
     */
    suspend fun sendChat(text: String, onFrame: (ChatFrame) -> Unit) {
        val payload = apiJson.encodeToString(buildJsonObject { put("text", text) })
        try {
            http.prepareRequest {
                method = HttpMethod.Post
                url(session.apiUrl + "/api/chat")
                contentType(ContentType.Application.Json)
                session.token?.let { header(HttpHeaders.Authorization, "Bearer $it") }
                setBody(payload)
                timeout {
                    requestTimeoutMillis = 120_000
                    socketTimeoutMillis = 120_000
                }
            }.execute { response ->
                if (response.status == HttpStatusCode.Unauthorized) {
                    session.clear()
                    throw ApiException(401, "Нужно войти снова")
                }
                if (!response.status.isSuccess()) {
                    throw ApiException(response.status.value, errorText(response.bodyAsText(), response.status.value))
                }
                onFrame(ChatFrame.Opened)
                val channel = response.bodyAsChannel()
                val pending = StringBuilder()
                while (true) {
                    val line = channel.readUTF8Line() ?: break
                    pending.append(line).append('\n')
                    val (events, rest) = consumeSse(pending.toString())
                    pending.clear()
                    pending.append(rest)
                    events.forEach { raw -> parseChatFrame(raw)?.let(onFrame) }
                }
                val (tail, _) = consumeSse(pending.toString() + "\n\n")
                tail.forEach { raw -> parseChatFrame(raw)?.let(onFrame) }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            throw ApiException(0, e.message ?: "Нет соединения с сервером")
        }
    }

    private suspend fun auth(path: String, username: String, password: String, name: String?): User {
        val body = buildJsonObject {
            put("username", username.trim())
            put("password", password)
            if (name != null) put("name", name.trim())
        }
        val sessionBody: SessionResponse = decode(request(HttpMethod.Post, path, body))
        session.token = sessionBody.token
        session.saveUser(sessionBody.user)
        runCatching { setTimeZone(TimeZone.currentSystemDefault().id) }
        return sessionBody.user
    }

    private fun JsonObjectBuilder.putExtras(extras: EventExtras, update: Boolean) {
        extras.repeat?.let { if (update || it.isNotBlank()) put("repeat", it) }
        extras.attendees?.let { list -> if (update || list.isNotEmpty()) put("attendees", JsonArray(list.map { JsonPrimitive(it) })) }
        extras.url?.let { if (update || it.isNotBlank()) put("url", it.trim()) }
        if (extras.reminderTouched) {
            val minutes = extras.reminder
            when {
                minutes == null -> if (update) put("reminders", JsonNull)
                minutes < 0 -> put("reminders", JsonArray(emptyList()))
                else -> put("reminders", JsonArray(listOf(JsonPrimitive(minutes))))
            }
        }
    }

    private suspend inline fun <reified T> decode(body: String): T = apiJson.decodeFromString(body)

    private suspend fun request(method: HttpMethod, path: String, body: JsonObject?): String {
        try {
            return http.prepareRequest {
                this.method = method
                url(session.apiUrl + path)
                session.token?.let { header(HttpHeaders.Authorization, "Bearer $it") }
                if (body != null) {
                    contentType(ContentType.Application.Json)
                    setBody(apiJson.encodeToString(body))
                }
            }.execute { response ->
                val text = response.bodyAsText()
                if (response.status == HttpStatusCode.Unauthorized && session.token != null) {
                    session.clear()
                    throw ApiException(401, errorText(text, 401))
                }
                if (!response.status.isSuccess()) {
                    throw ApiException(response.status.value, errorText(text, response.status.value))
                }
                text
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            throw ApiException(0, "Нет соединения с сервером")
        }
    }
}
