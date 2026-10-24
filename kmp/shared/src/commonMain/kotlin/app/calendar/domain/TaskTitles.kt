package app.calendar.domain

import app.calendar.api.Task

/**
 * Подсказки названия новой задачи из прежних (как `titleSuggestions` в вебе): названия, содержащие ввод
 * без учёта регистра, сначала начинающиеся с него. Повторы и точное совпадение с вводом не показываем.
 */
fun titleSuggestions(tasks: List<Task>, query: String, limit: Int = 4): List<String> {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return emptyList()
    val seen = mutableSetOf<String>()
    val starts = mutableListOf<String>()
    val inside = mutableListOf<String>()
    for (task in tasks) {
        val name = task.title.trim()
        val key = name.lowercase()
        if (name.isEmpty() || key == q || !seen.add(key)) continue
        if (key.startsWith(q)) starts += name else if (key.contains(q)) inside += name
    }
    return (starts + inside).take(limit)
}
