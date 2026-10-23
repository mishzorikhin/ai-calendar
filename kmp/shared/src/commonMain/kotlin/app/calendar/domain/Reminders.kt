package app.calendar.domain

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
