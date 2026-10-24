package app.calendar

import app.calendar.domain.addedLabel
import app.calendar.domain.alarmPresets
import app.calendar.domain.alarmWhenLabel
import app.calendar.domain.birthdayFromInput
import app.calendar.domain.decodeQuiet
import app.calendar.domain.encodeQuiet
import app.calendar.domain.nextOccurrence
import app.calendar.domain.quietLabel
import kotlin.time.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
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

    @Test
    fun quietHoursRoundTrip() {
        assertEquals(-1, encodeQuiet(-1, -1))
        assertEquals(23 * 60 to 7 * 60, decodeQuiet(encodeQuiet(23 * 60, 7 * 60)))
        assertEquals(-1 to -1, decodeQuiet(-1))
        assertEquals("23:00–7:00", quietLabel(encodeQuiet(23 * 60, 7 * 60)))
        assertEquals("Нет", quietLabel(-1))
    }

    @Test
    fun alarmPresetsDependOnTime() {
        val utc = TimeZone.UTC
        val morning = Instant.parse("2026-10-23T10:00:00Z")
        assertEquals(
            listOf("Через 15 мин", "Через 30 мин", "Через час", "Через 3 часа", "Вечером в 19:00", "Завтра в 9:00"),
            alarmPresets(morning, utc).map { it.label },
        )
        val late = Instant.parse("2026-10-23T19:30:00Z")
        assertEquals(false, alarmPresets(late, utc).any { it.label.startsWith("Вечером") })
        assertEquals(Instant.parse("2026-10-24T09:00:00Z"), alarmPresets(late, utc).last().at)
    }

    @Test
    fun exactTimeRollsToTomorrowWhenPassed() {
        val now = Instant.parse("2026-10-23T10:00:00Z")
        assertEquals(Instant.parse("2026-10-23T18:00:00Z"), nextOccurrence(now, TimeZone.UTC, 18 * 60))
        assertEquals(Instant.parse("2026-10-24T09:00:00Z"), nextOccurrence(now, TimeZone.UTC, 9 * 60))
    }

    @Test
    fun alarmWhenLabels() {
        val now = Instant.parse("2026-10-23T10:00:00Z")
        val utc = TimeZone.UTC
        assertEquals("Сегодня в 18:00", alarmWhenLabel(Instant.parse("2026-10-23T18:00:00Z"), now, utc))
        assertEquals("Завтра в 9:05", alarmWhenLabel(Instant.parse("2026-10-24T09:05:00Z"), now, utc))
    }

    @Test
    fun addedLabels() {
        val today = LocalDate(2026, 10, 23)
        assertEquals("сегодня", addedLabel(today, today))
        assertEquals("вчера", addedLabel(LocalDate(2026, 10, 22), today))
        assertEquals("3 дня назад", addedLabel(LocalDate(2026, 10, 20), today))
    }
}
