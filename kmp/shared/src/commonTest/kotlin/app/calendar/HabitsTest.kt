package app.calendar.domain

import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HabitsTest {
    private val friday = LocalDate(2026, 10, 23)

    @Test
    fun streakCountsBackFromYesterdayWhenTodayNotMarked() {
        assertEquals(2, habitStreak("daily", listOf("2026-10-21", "2026-10-22"), friday))
        assertEquals(3, habitStreak("daily", listOf("2026-10-21", "2026-10-22", "2026-10-23"), friday))
        assertEquals(0, habitStreak("daily", listOf("2026-10-20"), friday))
    }

    @Test
    fun weekdaysSkipWeekend() {
        val monday = LocalDate(2026, 10, 26)
        assertEquals(2, habitStreak("weekdays", listOf("2026-10-22", "2026-10-23"), monday))
        // В выходной считаем от пятницы.
        assertEquals(1, habitStreak("weekdays", listOf("2026-10-23"), LocalDate(2026, 10, 25)))
    }

    @Test
    fun weeklyCountsWeeks() {
        assertEquals(2, habitStreak("weekly", listOf("2026-10-14", "2026-10-21"), friday))
        assertEquals(1, habitStreak("weekly", listOf("2026-10-14"), friday))
    }

    @Test
    fun weeklyIsCheckedByAnyDayOfTheWeek() {
        assertTrue(habitCheckedNow("weekly", listOf("2026-10-19"), friday))
        assertFalse(habitCheckedNow("weekly", listOf("2026-10-18"), friday))
        assertFalse(habitCheckedNow("daily", listOf("2026-10-19"), friday))
        assertEquals("2026-10-19", habitMarkToClear("weekly", listOf("2026-10-19"), friday))
        assertNull(habitMarkToClear("daily", listOf("2026-10-22"), friday))
    }

    @Test
    fun weekDotsStartOnMonday() {
        val dots = habitWeekDots(listOf("2026-10-19", "2026-10-23"), friday)
        assertEquals(7, dots.size)
        assertEquals(LocalDate(2026, 10, 19), dots.first().first)
        assertTrue(dots.first().second)
        assertTrue(dots[4].second)
        assertFalse(dots[1].second)
    }
}
