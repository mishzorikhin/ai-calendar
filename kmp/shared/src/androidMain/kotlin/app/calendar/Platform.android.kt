package app.calendar

import android.content.Context
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp

private lateinit var appContext: Context

fun initAndroid(context: Context) {
    appContext = context.applicationContext
}

private class AndroidSettings(context: Context) : Settings {
    private val prefs = context.getSharedPreferences("calendar", Context.MODE_PRIVATE)

    override fun get(key: String): String? = prefs.getString(key, null)

    override fun put(key: String, value: String?) {
        prefs.edit().apply {
            if (value == null) remove(key) else putString(key, value)
            apply()
        }
    }
}

actual fun platformSettings(): Settings = AndroidSettings(appContext)

actual fun createHttpClient(): HttpClient = HttpClient(OkHttp) { installCalendar() }
