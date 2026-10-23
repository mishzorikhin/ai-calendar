package app.calendar.api

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
import io.ktor.http.isSuccess
import io.ktor.utils.io.readUTF8Line
import kotlinx.coroutines.CancellationException
import kotlinx.datetime.TimeZone
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
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

    suspend fun createEvent(date: String, title: String, start: Int, end: Int, badge: String, allDay: Boolean): Event {
        val body = buildJsonObject {
            put("date", date)
            put("title", title)
            put("start", if (allDay) 0 else start)
            put("end", if (allDay) 24 * 60 else end)
            put("badge", badge)
            if (allDay) put("allDay", true)
        }
        return decode(request(HttpMethod.Post, "/api/events", body))
    }

    suspend fun deleteEvent(id: String) {
        request(HttpMethod.Delete, "/api/events/$id", null)
    }

    suspend fun weekInsights(start: String): WeekInsights =
        decode(request(HttpMethod.Get, "/api/insights/week?start=$start", null))

    suspend fun tasks(): List<Task> = decode(request(HttpMethod.Get, "/api/tasks", null))

    suspend fun createTask(title: String, subtitle: String = "", kind: String = "task"): Task =
        decode(request(HttpMethod.Post, "/api/tasks", buildJsonObject {
            put("title", title)
            if (subtitle.isNotBlank()) put("subtitle", subtitle)
            if (kind != "task") put("kind", kind)
        }))

    suspend fun setTaskDone(id: String, done: Boolean): Task =
        decode(request(HttpMethod.Patch, "/api/tasks/$id", buildJsonObject { put("done", done) }))

    suspend fun checkHabit(id: String, date: String, done: Boolean): Task {
        val body = buildJsonObject { put(if (done) "check" else "uncheck", date) }
        return decode(request(HttpMethod.Patch, "/api/tasks/$id", body))
    }

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
