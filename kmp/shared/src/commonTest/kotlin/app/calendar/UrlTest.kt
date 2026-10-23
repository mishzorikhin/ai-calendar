package app.calendar

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class UrlTest {
    @Test
    fun httpAllowedOnlyInLocalNetwork() {
        listOf("localhost", "127.0.0.1", "10.0.2.2", "192.168.1.5", "172.16.0.1", "172.31.255.1", "nas.local")
            .forEach { assertTrue(isLocalHost(it), it) }
        listOf("example.com", "8.8.8.8", "172.32.0.1", "192.169.0.1", "10.0.0", "10.0.0.1.evil.com")
            .forEach { assertFalse(isLocalHost(it), it) }
    }
}
