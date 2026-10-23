package app.calendar

import app.calendar.domain.birthdayFromInput
import app.calendar.domain.birthdayToInput
import app.calendar.domain.dayTimeLabel
import app.calendar.domain.parseLogins
import app.calendar.domain.reminderShortLabel
import kotlin.test.Test
import kotlin.test.assertEquals

class RemindersTest {
    @Test
    fun shortLabels() {
        assertEquals("Нет", reminderShortLabel(-1))
        assertEquals("В начале", reminderShortLabel(0))
        assertEquals("10 мин", reminderShortLabel(10))
        assertEquals("2 ч", reminderShortLabel(120))
        assertEquals("За день", reminderShortLabel(1440))
    }

    @Test
    fun loginsAreCleaned() {
        assertEquals(listOf("gleb", "masha", "olga"), parseLogins("@gleb, masha  @olga gleb"))
        assertEquals(emptyList(), parseLogins("  , @ "))
    }

    @Test
    fun birthdayRoundTrip() {
        assertEquals("--03-14", birthdayFromInput("14.03"))
        assertEquals("1990-03-04", birthdayFromInput("4.3.1990"))
        assertEquals("14.03", birthdayToInput("--03-14"))
        assertEquals("04.03.1990", birthdayToInput("1990-03-04"))
    }

    @Test
    fun dayTime() {
        assertEquals("Выключено", dayTimeLabel(-1))
        assertEquals("9:05", dayTimeLabel(9 * 60 + 5))
    }
}
