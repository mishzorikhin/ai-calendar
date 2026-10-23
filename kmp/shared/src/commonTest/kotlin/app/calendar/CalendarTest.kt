package app.calendar.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CalendarTest {
    @Test
    fun october2026StartsOnThursday() {
        val cells = monthCells(2026, 10)
        assertEquals(listOf(null, null, null, 1), cells.take(4))
        assertEquals(31, cells.last())
        assertEquals(3 + 31, cells.size)
    }

    @Test
    fun february2024Has29Days() {
        assertEquals(29, daysInMonth(2024, 2))
        assertEquals(28, daysInMonth(2026, 2))
    }

    @Test
    fun formatMinutesPads() {
        assertEquals("9:05", formatMinutes(9 * 60 + 5))
        assertEquals("0:00", formatMinutes(0))
        assertEquals("24:00", formatMinutes(24 * 60))
    }

    @Test
    fun allDayRangeHasNoClock() {
        assertEquals("весь день", formatRange(0, 1440, allDay = true))
        assertTrue(formatRange(600, 660, allDay = false).contains("10:00"))
    }

    @Test
    fun partOfMatchesWebDay() {
        assertEquals(DayPart.Morning, partOf(5 * 60))
        assertEquals(DayPart.Morning, partOf(11 * 60))
        assertEquals(DayPart.Afternoon, partOf(12 * 60))
        assertEquals(DayPart.Night, partOf(18 * 60))
    }

    @Test
    fun monthDoesNotLeaveServerRange() {
        val jan = monthCells(1970, 1)
        assertEquals(1, jan.first { it != null })
        val first = kotlinx.datetime.LocalDate(1970, 1, 1)
        assertEquals(first, shiftMonth(first, -1))
    }

    @Test
    fun monthCrossesYear() {
        val december = kotlinx.datetime.LocalDate(2026, 12, 1)
        assertEquals(kotlinx.datetime.LocalDate(2027, 1, 1), shiftMonth(december, 1))
        assertEquals(kotlinx.datetime.LocalDate(2025, 12, 1), shiftMonth(kotlinx.datetime.LocalDate(2026, 1, 1), -1))
    }

    @Test
    fun weekStartsOnMonday() {
        val wednesday = kotlinx.datetime.LocalDate(2026, 10, 22)
        assertEquals(kotlinx.datetime.LocalDate(2026, 10, 19), startOfWeek(wednesday))
        assertEquals("19–25 октября", weekRangeLabel(startOfWeek(wednesday)))
    }

    @Test
    fun hoursTextFormats() {
        assertEquals("0", hoursText(0))
        assertEquals("2 ч 30 мин", hoursText(150))
        assertEquals("45 мин", hoursText(45))
    }
}
