package app.calendar

import platform.UIKit.UIApplication
import platform.Foundation.NSURL
import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import platform.Foundation.NSUserDefaults

private class IosSettings : Settings {
    private val defaults = NSUserDefaults.standardUserDefaults

    override fun get(key: String): String? = defaults.stringForKey(key)

    override fun put(key: String, value: String?) {
        if (value == null) defaults.removeObjectForKey(key) else defaults.setObject(value, forKey = key)
    }
}

actual fun platformSettings(): Settings = IosSettings()

actual fun createHttpClient(): HttpClient = HttpClient(Darwin) { installCalendar() }

actual fun openUrl(url: String) {
    val target = NSURL.URLWithString(url) ?: return
    UIApplication.sharedApplication.openURL(target, options = emptyMap<Any?, Any>(), completionHandler = null)
}
