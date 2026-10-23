package app.calendar.domain

import app.calendar.api.Event
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SuggestTest {
    private fun ev(start: Int, end: Int, allDay: Boolean = false) = Event(id = "$start", start = start, end = end, allDay = allDay)

    @Test
    fun otherDayStartsAtNine() {
        assertEquals(9 * 60, suggestStart(emptyList(), null))
    }

    @Test
    fun todayRoundsUpToHalfHour() {
        assertEquals(15 * 60 + 30, suggestStart(emptyList(), 15 * 60 + 12))
        assertEquals(15 * 60, suggestStart(emptyList(), 15 * 60))
    }

    @Test
    fun skipsBusyWindows() {
        val busy = listOf(ev(9 * 60, 11 * 60))
        assertEquals(11 * 60, suggestStart(busy, null))
        // Часовое окно не должно упираться в следующее событие.
        val gap = listOf(ev(9 * 60, 10 * 60), ev(10 * 60 + 30, 12 * 60))
        assertEquals(12 * 60, suggestStart(gap, null))
    }

    @Test
    fun allDayEventsDoNotBlock() {
        assertEquals(9 * 60, suggestStart(listOf(ev(0, 1440, allDay = true)), null))
    }

    @Test
    fun conflictFindsOverlapOnly() {
        val events = listOf(ev(600, 660))
        assertEquals("600", conflictWith(events, 630, 700)?.id)
        assertNull(conflictWith(events, 660, 720))
        assertNull(conflictWith(events, 540, 600))
    }
}
