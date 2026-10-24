package app.calendar

import app.calendar.api.User
import app.calendar.api.apiJson
import kotlinx.serialization.encodeToString

/** Снимок нужен только на время запроса; токен не попадает в toString. */
internal class SessionSnapshot(val apiUrl: String, val token: String?, val revision: Long)

class SessionStore(private val settings: Settings) {
    private var revision = 0L

    internal fun snapshot() = SessionSnapshot(apiUrl, token, revision)

    internal fun ensureCurrent(snapshot: SessionSnapshot) {
        if (snapshot.revision != revision || snapshot.apiUrl != apiUrl || snapshot.token != token) {
            throw kotlinx.coroutines.CancellationException("Сессия изменилась")
        }
    }

    /** Владелец очереди включает сервер: одинаковые id на разных серверах — разные люди. */
    fun ownerKey(userId: String): String = apiUrl + "#" + userId

    var token: String?
        get() = settings.get(KEY_TOKEN)?.takeIf { it.isNotBlank() }
        set(value) {
            revision++
            settings.put(KEY_TOKEN, value?.takeIf { it.isNotBlank() })
        }

    var apiUrl: String
        get() = settings.get(KEY_URL)?.trim()?.trimEnd('/')?.takeIf { it.isNotBlank() } ?: defaultApiUrl()
        set(value) {
            if (apiUrl != value.trim().trimEnd('/')) revision++
            settings.put(KEY_URL, value.trim().trimEnd('/'))
        }

    /** Тема оформления на этом устройстве: system, light или dark. */
    var theme: String
        get() = settings.get(KEY_THEME)?.takeIf { it in setOf("light", "dark") } ?: "system"
        set(value) = settings.put(KEY_THEME, value)

    fun loadUser(): User? {
        val raw = settings.get(KEY_USER) ?: return null
        return runCatching { apiJson.decodeFromString<User>(raw) }.getOrNull()
    }

    fun saveUser(user: User?) {
        settings.put(KEY_USER, user?.let { apiJson.encodeToString(it) })
    }

    fun clear() {
        token = null
        saveUser(null)
    }

    private companion object {
        const val KEY_TOKEN = "token"
        const val KEY_URL = "apiUrl"
        const val KEY_USER = "user"
        const val KEY_THEME = "theme"
    }
}
