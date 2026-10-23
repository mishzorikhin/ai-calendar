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
import kotlin.time.Clock
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
    private val outbox: Outbox,
    private val cache: ReadCache,
) {
    /** Сообщает, достучался ли последний запрос до сервера: по нему интерфейс показывает «Нет сети». */
    var onConnection: (Boolean) -> Unit = {}
    private var online = true

    private val sender = OutboxSender { method, path, body ->
        try {
            val text = request(HttpMethod.parse(method), path, body)
            SendResult.Ok(text.takeIf { it.isNotBlank() }?.let { apiJson.parseToJsonElement(it) })
        } catch (e: ApiException) {
            when {
                // Цель уже удалена — считаем выполненным.
                e.status == 404 && method != "POST" -> SendResult.Missing
                e.status == 0 || e.status == 401 || e.status >= 500 -> SendResult.Later
                else -> SendResult.Rejected
            }
        }
    }

    /** Повторяет очередь неотправленных изменений. Итог — что-то реально уехало или выброшено (надо обновить экран). */
    suspend fun flushOutbox(): FlushResult = outbox.flush(sender, session.loadUser()?.id?.toString())

    /**
     * Мутация с офлайн-очередью. Если очередь пуста, запрос идёт сразу; при обрыве сети (или если впереди уже есть
     * неотправленное — порядок важен) операция ложится в очередь, а вызывающий получает [local] — синтетический результат.
     */
    private suspend fun <T> mutate(
        entity: String,
        action: String,
        id: String?,
        method: String,
        path: String,
        body: JsonObject?,
        separate: Boolean = false,
        dedupePath: String? = null,
        dedupeMatch: List<String> = emptyList(),
        send: suspend (path: String) -> T,
        local: (id: String) -> T,
    ): T {
        val temp = if (action == "create") newTempId() else null
        val entityId = temp ?: id.orEmpty()
        val real = if (temp == null) outbox.resolveId(entityId) else entityId
        var unreachable = false
        // Сущность, чьё создание ещё в очереди, на сервере не существует — правки идут только в очередь.
        if (outbox.size == 0 && (temp != null || !isTempId(real))) {
            try {
                return send(path.replace(":id", real))
            } catch (e: ApiException) {
                if (e.status != 0) throw e
                unreachable = true
            }
        }
        outbox.enqueue(
            PendingOp(
                entity = entity,
                action = action,
                entityId = entityId,
                tempId = temp,
                method = method,
                path = path,
                body = body,
                dedupePath = dedupePath,
                dedupeMatch = dedupeMatch,
                at = Clock.System.now().toEpochMilliseconds(),
                separate = separate,
            ),
        )
        if (!unreachable && online) flushOutbox()
        return local(entityId)
    }

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

    suspend fun events(date: String): List<Event> {
        val base = try {
            decode<List<Event>>(request(HttpMethod.Get, "/api/events?date=$date", null)).also { cache.putEvents(date, it) }
        } catch (e: ApiException) {
            if (e.status != 0) throw e
            cache.events(date).orEmpty()
        }
        return mergeEvents(base, outbox.ops, date)
    }

    suspend fun monthDots(year: Int, month: Int): Map<Int, List<String>> {
        val base = try {
            val raw = request(HttpMethod.Get, "/api/month?year=$year&month=$month", null)
            val parsed = apiJson.decodeFromString<Map<String, List<String>>>(raw)
            parsed.mapNotNull { (day, badges) -> day.toIntOrNull()?.let { it to badges } }.toMap()
                .also { cache.putDots(year, month, it) }
        } catch (e: ApiException) {
            if (e.status != 0) throw e
            cache.dots(year, month).orEmpty()
        }
        return mergeDots(base, outbox.ops, year, month)
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
        return mutate(
            "event", "create", null, "POST", "/api/events", body,
            dedupePath = "/api/events?date=$date",
            dedupeMatch = listOf("title", "start", "end"),
            send = { path -> decode<Event>(request(HttpMethod.Post, path, body)) },
            local = { id ->
                Event(
                    id = id, date = date, title = title, subtitle = extras.subtitle.orEmpty(),
                    start = if (allDay) 0 else start, end = if (allDay) 24 * 60 else end,
                    badge = badge, allDay = allDay, notes = notes.trim(),
                )
            },
        )
    }

    /** Правка события целиком: поля, которых нет в [fields], не трогаются. */
    suspend fun updateEvent(id: String, extras: EventExtras, fields: JsonObject): Event {
        val merged = JsonObject(fields + buildJsonObject { putExtras(extras, update = true) })
        // Правки серии не склеиваются: второй «убрать день» затёр бы первый, а перенос — свой occurrence.
        val separate = "skip" in merged || "occurrence" in merged
        return mutate(
            "event", "update", id, "PATCH", "/api/events/:id", merged, separate = separate,
            send = { path -> decode<Event>(request(HttpMethod.Patch, path, merged)) },
            local = { Event(id = it) },
        )
    }

    suspend fun updateEvent(id: String, fields: JsonObject): Event = updateEvent(id, EventExtras(), fields)

    suspend fun rsvp(id: String, status: String) {
        request(HttpMethod.Post, "/api/events/$id/rsvp", buildJsonObject { put("status", status) })
    }

    suspend fun search(query: String): SearchResult =
        decode(request(HttpMethod.Get, "/api/search?q=${query.encodeURLParameter()}", null))

    suspend fun deleteEvent(id: String) {
        mutate(
            "event", "delete", id, "DELETE", "/api/events/:id", null,
            send = { path -> request(HttpMethod.Delete, path, null); Unit },
            local = { },
        )
    }

    suspend fun weekInsights(start: String): WeekInsights =
        decode(request(HttpMethod.Get, "/api/insights/week?start=$start", null))

    suspend fun tasks(): List<Task> {
        val base = try {
            decode<List<Task>>(request(HttpMethod.Get, "/api/tasks", null)).also { cache.putTasks(it) }
        } catch (e: ApiException) {
            if (e.status != 0) throw e
            cache.tasks().orEmpty()
        }
        return mergeTasks(base, outbox.ops)
    }

    suspend fun createTask(task: NewTask): Task {
        val body = buildJsonObject {
            put("title", task.title)
            if (task.note.isNotBlank()) put("subtitle", task.note)
            if (task.kind != "task") put("kind", task.kind)
            if (task.category.isNotBlank()) put("category", task.category)
            if (task.estimate > 0) put("estimate", task.estimate)
            if (task.due.isNotBlank()) put("due", task.due)
            if (task.cadence.isNotBlank()) put("cadence", task.cadence)
            if (task.members.isNotEmpty()) put("members", JsonArray(task.members.map { JsonPrimitive(it) }))
        }
        return mutate(
            "task", "create", null, "POST", "/api/tasks", body,
            dedupePath = "/api/tasks",
            dedupeMatch = listOf("title"),
            send = { path -> decode<Task>(request(HttpMethod.Post, path, body)) },
            local = { id ->
                Task(
                    id = id, title = task.title, subtitle = task.note, kind = task.kind,
                    category = task.category, estimate = task.estimate, due = task.due, cadence = task.cadence,
                )
            },
        )
    }

    suspend fun updateTask(id: String, fields: JsonObject): Task =
        mutate(
            "task", "update", id, "PATCH", "/api/tasks/:id", fields,
            // Отметки привычки не склеиваются: «отметить» и «снять» за разные дни — разные операции.
            separate = "check" in fields || "uncheck" in fields,
            send = { path -> decode<Task>(request(HttpMethod.Patch, path, fields)) },
            local = { Task(id = it) },
        )

    suspend fun deleteTask(id: String) {
        mutate(
            "task", "delete", id, "DELETE", "/api/tasks/:id", null,
            send = { path -> request(HttpMethod.Delete, path, null); Unit },
            local = { },
        )
    }

    suspend fun setTaskDone(id: String, done: Boolean): Task = updateTask(id, buildJsonObject { put("done", done) })

    suspend fun checkHabit(id: String, date: String, done: Boolean): Task =
        updateTask(id, buildJsonObject { put(if (done) "check" else "uncheck", date) })

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
        } catch (e: Throwable) {
            // В вебе (Wasm) сбой fetch приходит как kotlin.Error, а не Exception — ловим и его, иначе он уйдёт мимо баннера.
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
        extras.subtitle?.let { if (update || it.isNotBlank()) put("subtitle", it.trim()) }
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

    private fun reachable(value: Boolean) {
        if (online == value) return
        online = value
        onConnection(value)
    }

    private suspend fun request(method: HttpMethod, path: String, body: JsonObject?): String {
        try {
            val result = http.prepareRequest {
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
            reachable(true)
            return result
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            // Сервер ответил (пусть и ошибкой) — сеть есть.
            reachable(true)
            throw e
        } catch (e: Throwable) {
            // См. выше: в вебе сетевой сбой — kotlin.Error.
            reachable(false)
            throw ApiException(0, "Нет соединения с сервером")
        }
    }
}
