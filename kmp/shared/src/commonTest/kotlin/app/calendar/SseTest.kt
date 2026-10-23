package app.calendar.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SseTest {
    @Test
    fun keepsIncompleteFrame() {
        val (events, rest) = consumeSse("data: {\"type\":\"delta\",\"text\":\"При\"}\n\ndata: {\"type\":\"del")
        assertEquals(1, events.size)
        assertTrue(rest.contains("del"))
        assertIs<ChatFrame.Delta>(parseChatFrame(events.first()))
    }

    @Test
    fun parsesConfirmAndDone() {
        val raw = """{"type":"confirm","confirm":{"id":"c1","title":"Удалить?","button":"Удалить"}}"""
        val frame = parseChatFrame(raw)
        assertIs<ChatFrame.Confirm>(frame)
        assertEquals("c1", frame.card.id)
        assertEquals("Удалить", frame.card.button)
        assertIs<ChatFrame.Done>(parseChatFrame("""{"type":"done"}"""))
    }

    @Test
    fun acceptsCrlf() {
        val (events, rest) = consumeSse("data: {\"type\":\"done\"}\r\n\r\n")
        assertEquals(listOf("""{"type":"done"}"""), events)
        assertEquals("", rest)
    }
}
