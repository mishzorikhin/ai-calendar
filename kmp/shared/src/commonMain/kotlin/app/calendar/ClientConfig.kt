package app.calendar

import io.ktor.client.HttpClientConfig
import io.ktor.client.plugins.HttpTimeout

internal fun HttpClientConfig<*>.installCalendar() {
    install(HttpTimeout) {
        requestTimeoutMillis = 20_000
        connectTimeoutMillis = 10_000
        socketTimeoutMillis = 20_000
    }
}
