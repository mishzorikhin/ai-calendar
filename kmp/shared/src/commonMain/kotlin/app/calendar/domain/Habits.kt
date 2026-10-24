package app.calendar.domain

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.plus

private fun shift(date: LocalDate, days: Int) = date.plus(DatePeriod(days = days))

private fun isWeekend(date: LocalDate) = date.dayOfWeek.isoDayNumber >= 6

/**
 * Сколько периодов подряд привычка выполнена, считая назад от [today]; порт `habitStreak` из `src/domain/habit.ts`.
 * Текущий период может быть ещё не отмечен — тогда серия считается с прошлого. `weekdays` — выходные не прерывают.
 */
fun habitStreak(cadence: String, checks: List<String>, today: LocalDate): Int {
    val marked = checks.mapNotNull { runCatching { parseIsoDate(it) }.getOrNull() }.toSet()
    if (cadence == "weekly") {
        val weeks = marked.map(::startOfWeek).toSet()
        var week = startOfWeek(today)
        if (week !in weeks) week = shift(week, -7)
        var n = 0
        while (week in weeks) {
            n++
            week = shift(week, -7)
        }
        return n
    }
    val skip = { d: LocalDate -> cadence == "weekdays" && isWeekend(d) }
    val back = { d: LocalDate ->
        var x = shift(d, -1)
        while (skip(x)) x = shift(x, -1)
        x
    }
    var day = today
    while (skip(day)) day = shift(day, -1)
    if (day !in marked) day = back(day)
    var n = 0
    while (day in marked) {
        n++
        day = back(day)
    }
    return n
}

/** Отмечена ли привычка в текущем периоде: сегодня или (для `weekly`) на этой неделе. */
fun habitCheckedNow(cadence: String, checks: List<String>, today: LocalDate): Boolean {
    if (cadence != "weekly") return isoDate(today) in checks
    val week = startOfWeek(today)
    return checks.any { raw -> runCatching { startOfWeek(parseIsoDate(raw)) == week }.getOrDefault(false) }
}

/** Отметка, которую надо снять, чтобы привычка перестала быть выполненной в этом периоде. */
fun habitMarkToClear(cadence: String, checks: List<String>, today: LocalDate): String? {
    if (cadence != "weekly") return isoDate(today).takeIf { it in checks }
    val week = startOfWeek(today)
    return checks.lastOrNull { raw -> runCatching { startOfWeek(parseIsoDate(raw)) == week }.getOrDefault(false) }
}

/** Точки недели с понедельника: дата и отметка. */
fun habitWeekDots(checks: List<String>, today: LocalDate): List<Pair<LocalDate, Boolean>> {
    val monday = startOfWeek(today)
    return (0 until 7).map { i ->
        val date = shift(monday, i)
        date to (isoDate(date) in checks)
    }
}

fun streakUnit(cadence: String): Triple<String, String, String> =
    if (cadence == "weekly") Triple("неделя", "недели", "недель") else Triple("день", "дня", "дней")
