package app.calendar.domain

import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.LocalTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime

/** Варианты напоминания о событии, минут до начала (как `REMINDER_PRESETS` в вебе). */
val reminderPresets = listOf(0, 5, 10, 15, 30, 60, 120, 1440)

/** Короткая подпись для плашки: «Нет», «В начале», «10 мин», «1 ч», «За день». −1 — не напоминать. */
fun reminderShortLabel(minutes: Int): String = when {
    minutes < 0 -> "Нет"
    minutes == 0 -> "В начале"
    minutes == 1440 -> "За день"
    minutes % 1440 == 0 -> "${minutes / 1440} дн"
    minutes % 60 == 0 -> "${minutes / 60} ч"
    else -> "$minutes мин"
}

/** Логины из строки «@gleb, masha @olga»: без «@», без повторов, не длиннее [limit]. */
fun parseLogins(raw: String, limit: Int = 20): List<String> =
    raw.split(' ', ',', ';', '\n', '\t')
        .map { it.trim().removePrefix("@") }
        .filter { it.isNotEmpty() }
        .distinct()
        .take(limit)

/** «9:00»; −1 — «Выключено». */
fun dayTimeLabel(minutes: Int): String =
    if (minutes < 0) "Выключено" else "${minutes / 60}:${(minutes % 60).toString().padStart(2, '0')}"

/** «14.03» или «14.03.1990» ↔ «--03-14» или «1990-03-14» (как в карточке человека на сайте). */
fun birthdayFromInput(raw: String): String {
    val match = Regex("""^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$""").matchEntire(raw.trim()) ?: return raw.trim()
    val (day, month, year) = match.destructured
    val dd = day.padStart(2, '0')
    val mm = month.padStart(2, '0')
    return if (year.isEmpty()) "--$mm-$dd" else "$year-$mm-$dd"
}

fun birthdayToInput(value: String): String {
    Regex("""^--(\d{2})-(\d{2})$""").matchEntire(value)?.let { return "${it.groupValues[2]}.${it.groupValues[1]}" }
    Regex("""^(\d{4})-(\d{2})-(\d{2})$""").matchEntire(value)?.let { return "${it.groupValues[3]}.${it.groupValues[2]}.${it.groupValues[1]}" }
    return value
}

/** Варианты времени для напоминаний о задачах и сводок, минуты от полуночи (как `DAY_TIME_PRESETS`). */
val dayTimePresets = listOf(7 * 60, 8 * 60, 9 * 60, 10 * 60, 12 * 60, 18 * 60, 20 * 60, 21 * 60)

/** Готовые тихие часы: начало и конец в минутах от полуночи. */
val quietPresets = listOf(22 * 60 to 7 * 60, 23 * 60 to 7 * 60, 23 * 60 to 8 * 60, 0 to 8 * 60)

/** Тихие часы одним числом для выбора «таблетками»: −1 — выключены. */
fun encodeQuiet(from: Int, to: Int): Int = if (from < 0 || to < 0) -1 else from * 1440 + to

fun decodeQuiet(code: Int): Pair<Int, Int> = if (code < 0) -1 to -1 else code / 1440 to code % 1440

/** «23:00–7:00»; −1 — «Нет». */
fun quietLabel(code: Int): String {
    if (code < 0) return "Нет"
    val (from, to) = decodeQuiet(code)
    return "${dayTimeLabel(from)}–${dayTimeLabel(to)}"
}

/** «Нет» для −1, иначе время («9:00»). */
fun timeChoiceLabel(minutes: Int): String = if (minutes < 0) "Нет" else dayTimeLabel(minutes)

/** Быстрый вариант времени для своего напоминания. */
data class AlarmPreset(val label: String, val at: Instant)

/** Как `alarmPresets` в вебе. Вечерний вариант — пока 18:00 не наступило. */
fun alarmPresets(now: Instant, zone: TimeZone): List<AlarmPreset> {
    val local = now.toLocalDateTime(zone)
    fun at(days: Int, hour: Int): Instant =
        LocalDateTime(local.date.plus(DatePeriod(days = days)), LocalTime(hour, 0)).toInstant(zone)
    return buildList {
        add(AlarmPreset("Через 15 мин", now + 15.minutes))
        add(AlarmPreset("Через 30 мин", now + 30.minutes))
        add(AlarmPreset("Через час", now + 60.minutes))
        add(AlarmPreset("Через 3 часа", now + 180.minutes))
        if (local.hour < 18) add(AlarmPreset("Вечером в 19:00", at(0, 19)))
        add(AlarmPreset("Завтра в 9:00", at(1, 9)))
    }
}

/** Ближайшее наступление времени [minutes] от полуночи: прошедшее сегодня значит завтра. */
fun nextOccurrence(now: Instant, zone: TimeZone, minutes: Int): Instant {
    val today = now.toLocalDateTime(zone).date
    val first = LocalDateTime(today, LocalTime(minutes / 60, minutes % 60)).toInstant(zone)
    return if (first <= now) {
        LocalDateTime(today.plus(DatePeriod(days = 1)), LocalTime(minutes / 60, minutes % 60)).toInstant(zone)
    } else {
        first
    }
}

/** «Сегодня в 18:00», «Завтра в 9:05», «Сб, 24 октября в 10:00». */
fun alarmWhenLabel(at: Instant, now: Instant, zone: TimeZone): String {
    val local = at.toLocalDateTime(zone)
    val today = now.toLocalDateTime(zone).date
    val day = when (local.date) {
        today -> "Сегодня"
        today.plus(DatePeriod(days = 1)) -> "Завтра"
        else -> "${weekdayShort(local.date)}, ${local.date.dayOfMonth} ${monthGenitive(local.date)}"
    }
    return "$day в ${dayTimeLabel(local.hour * 60 + local.minute)}"
}

/** «сегодня», «вчера», «3 дня назад», «23 октября» — когда добавлено устройство. */
fun addedLabel(date: LocalDate, today: LocalDate): String {
    val days = today.toEpochDays() - date.toEpochDays()
    return when {
        days <= 0 -> "сегодня"
        days == 1L -> "вчера"
        days < 7 -> "${pluralize(days.toInt(), "день", "дня", "дней")} назад"
        else -> "${date.dayOfMonth} ${monthGenitive(date)}"
    }
}

/** Разбор `2026-10-23T18:00:00Z` (и со смещением) из ответа сервера; при ошибке — null. */
fun parseInstant(raw: String): Instant? = runCatching { Instant.parse(raw) }.getOrNull()

/** День начала суток в зоне — для `addedLabel`. */
fun localDate(at: Instant, zone: TimeZone): LocalDate = at.toLocalDateTime(zone).date
