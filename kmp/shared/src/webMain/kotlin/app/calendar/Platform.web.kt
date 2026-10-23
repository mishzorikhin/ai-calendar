package app.calendar

import io.ktor.client.HttpClient
import io.ktor.client.engine.js.Js
import kotlinx.browser.localStorage

private class WebSettings : Settings {
    override fun get(key: String): String? = localStorage.getItem(key)

    override fun put(key: String, value: String?) {
        if (value == null) localStorage.removeItem(key) else localStorage.setItem(key, value)
    }
}

actual fun platformSettings(): Settings = WebSettings()

actual fun createHttpClient(): HttpClient = HttpClient(Js) { installCalendar() }
