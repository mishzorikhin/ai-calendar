package app.calendar.domain

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.plus

/** Часть суток — как на веб-экране дня. До 6 утра считаем утром. */
enum class DayPart(val title: String) {
    Morning("Утро"),
    Afternoon("День"),
    Night("Вечер"),
}

fun partOf(minutes: Int): DayPart = when (minutes) {
    in 6 * 60 until 12 * 60 -> DayPart.Morning
    in 12 * 60 until 18 * 60 -> DayPart.Afternoon
    in 18 * 60 until 24 * 60 -> DayPart.Night
    else -> DayPart.Morning
}

/** «9:05». Конец суток — «24:00». */
fun formatMinutes(minutes: Int): String {
    val clamped = minutes.coerceIn(0, 24 * 60)
    val hour = clamped / 60
    val minute = clamped % 60
    return "$hour:${minute.toString().padStart(2, '0')}"
}

fun formatRange(start: Int, end: Int, allDay: Boolean): String =
    if (allDay) "весь день" else "${formatMinutes(start)}–${formatMinutes(end)}"

private val weekdays = listOf(
    "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье",
)
private val weekdaysShort = listOf("Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс")
private val months = listOf(
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
)
private val monthsGenitive = listOf(
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)
private val monthsShort = listOf("янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек")

fun weekdayName(date: LocalDate): String = weekdays[date.dayOfWeek.isoDayNumber - 1]

fun monthShort(date: LocalDate): String = monthsShort[date.monthNumber - 1]

fun monthGenitive(date: LocalDate): String = monthsGenitive[date.monthNumber - 1]

/** «0 событий», «1 событие», «2 события». */
fun pluralize(n: Int, one: String, few: String, many: String): String {
    val abs = kotlin.math.abs(n) % 100
    val last = abs % 10
    val word = when {
        abs in 11..14 -> many
        last == 1 -> one
        last in 2..4 -> few
        else -> many
    }
    return "$n $word"
}

fun avatarColor(username: String): Long {
    val palette = longArrayOf(0xFFDFE4F8, 0xFFFDE4D8, 0xFFD8F0E0, 0xFFF3E2F5, 0xFFFDF0C8, 0xFFDCEEF7, 0xFFF8DDD8)
    var hash = 0
    username.forEach { hash = (hash * 31 + it.code) % 997 }
    return palette[(hash % palette.size + palette.size) % palette.size]
}

fun weekdayShort(date: LocalDate): String = weekdaysShort[date.dayOfWeek.isoDayNumber - 1]

fun monthName(month: Int): String = months[month - 1].replaceFirstChar { it.uppercase() }

fun monthTitle(date: LocalDate): String = "${monthName(date.monthNumber)} ${date.year}"

/** «четверг, 22 октября». */
fun dayTitle(date: LocalDate): String {
    val weekday = weekdays[date.dayOfWeek.isoDayNumber - 1]
    return "$weekday, ${date.dayOfMonth} ${monthsGenitive[date.monthNumber - 1]}"
}

fun isoDate(date: LocalDate): String =
    "${date.year.toString().padStart(4, '0')}-${date.monthNumber.toString().padStart(2, '0')}-${date.dayOfMonth.toString().padStart(2, '0')}"

fun parseIsoDate(raw: String): LocalDate {
    val parts = raw.split('-')
    return LocalDate(parts[0].toInt(), parts[1].toInt(), parts[2].toInt())
}

/** Понедельник той же недели. */
fun startOfWeek(date: LocalDate): LocalDate =
    date.plus(DatePeriod(days = -(date.dayOfWeek.isoDayNumber - 1)))

/** «12–18 октября» или «30 сентября – 6 октября». */
fun weekRangeLabel(start: LocalDate): String {
    val end = start.plus(DatePeriod(days = 6))
    return if (start.monthNumber == end.monthNumber) {
        "${start.dayOfMonth}–${end.dayOfMonth} ${monthsGenitive[end.monthNumber - 1]}"
    } else {
        "${start.dayOfMonth} ${monthsGenitive[start.monthNumber - 1]} – ${end.dayOfMonth} ${monthsGenitive[end.monthNumber - 1]}"
    }
}

/** «2 ч 30 мин», «45 мин», «0». */
fun hoursText(minutes: Int): String {
    if (minutes <= 0) return "0"
    val h = minutes / 60
    val m = minutes % 60
    return buildList {
        if (h > 0) add("$h ч")
        if (m > 0) add("$m мин")
    }.joinToString(" ")
}

/** Склонение без числа — «задача закрыта». */
fun pluralWord(n: Int, one: String, few: String, many: String): String {
    val abs = kotlin.math.abs(n) % 100
    val last = abs % 10
    return when {
        abs in 11..14 -> many
        last == 1 -> one
        last in 2..4 -> few
        else -> many
    }
}

private val weekdaysChart = listOf("вс", "пн", "вт", "ср", "чт", "пт", "сб")

/** Короткий день для столбиков недели — как SHORT_WEEKDAYS в веб-клиенте. */
fun weekdayChartShort(date: LocalDate): String = weekdaysChart[date.dayOfWeek.isoDayNumber % 7]

data class BadgeOption(val id: String, val label: String)

val badgeOptions = listOf(
    BadgeOption("routine", "Дело"),
    BadgeOption("work", "Работа"),
    BadgeOption("food", "Еда"),
    BadgeOption("sport", "Спорт"),
    BadgeOption("read", "Чтение"),
    BadgeOption("sleep", "Сон"),
)

fun shiftMonth(firstOfMonth: LocalDate, delta: Int): LocalDate {
    val shifted = firstOfMonth.plus(DatePeriod(months = delta))
    return if (shifted.year in 1970..2100) LocalDate(shifted.year, shifted.monthNumber, 1) else firstOfMonth
}

/**
 * Клетки месяца, неделя с понедельника. Пустые клетки до первого дня — null.
 * Октябрь 2026 начинается в четверг: три пустые клетки, затем 1.
 */
fun monthCells(year: Int, month: Int): List<Int?> {
    val first = LocalDate(year, month, 1)
    val lead = first.dayOfWeek.isoDayNumber - 1
    val days = daysInMonth(year, month)
    return List(lead) { null } + (1..days).map { it }
}

fun daysInMonth(year: Int, month: Int): Int = when (month) {
    1, 3, 5, 7, 8, 10, 12 -> 31
    4, 6, 9, 11 -> 30
    else -> if (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)) 29 else 28
}

fun badgeLabel(badge: String): String = when (badge) {
    "sleep" -> "сон"
    "routine" -> "быт"
    "work" -> "работа"
    "food" -> "еда"
    "sport" -> "спорт"
    "read" -> "чтение"
    else -> "дело"
}

fun toolLabel(name: String): String = when (name) {
    "get_day_schedule" -> "Смотрю день"
    "find_free_slots" -> "Ищу окно"
    "create_event" -> "Ставлю событие"
    "update_event" -> "Меняю событие"
    "delete_event" -> "Предлагаю удалить"
    "list_tasks" -> "Смотрю задачи"
    "create_task" -> "Добавляю задачу"
    "update_task" -> "Меняю задачу"
    "delete_task" -> "Предлагаю удалить задачу"
    "clear_day" -> "Предлагаю освободить день"
    "shift_events" -> "Предлагаю перенести"
    else -> "Думаю"
}
