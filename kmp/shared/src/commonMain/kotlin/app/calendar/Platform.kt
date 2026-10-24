package app.calendar

import io.ktor.client.HttpClient

/** Хранилище адреса сервера, токена и имени — на каждой платформе своё. */
interface Settings {
    fun get(key: String): String?
    fun put(key: String, value: String?)
}

expect fun platformSettings(): Settings

expect fun createHttpClient(): HttpClient

fun defaultApiUrl(): String = "https://aicall.mish-tech.ru"

/** Открывает ссылку во внешнем браузере (вход Google/Outlook, адрес ленты). */
expect fun openUrl(url: String)
