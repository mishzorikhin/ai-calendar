package app.calendar

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp

private class MemorySettings : Settings {
    private val values = mutableMapOf<String, String>()

    override fun get(key: String): String? = values[key]

    override fun put(key: String, value: String?) {
        if (value == null) values.remove(key) else values[key] = value
    }
}

actual fun platformSettings(): Settings = MemorySettings()

actual fun createHttpClient(): HttpClient = HttpClient(OkHttp) { installCalendar() }

actual fun openUrl(url: String) {
    runCatching { java.awt.Desktop.getDesktop().browse(java.net.URI(url)) }
}
