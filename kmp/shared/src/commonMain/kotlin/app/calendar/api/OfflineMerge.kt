package app.calendar.api

import app.calendar.Settings
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

// Слияние ответа сервера с ещё не отправленными операциями — перенос `mergeEvents` и `mergeTasks` из
// `src/api/offline.ts`: созданное офлайн видно сразу, удалённое скрыто, правки применены.

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
private fun JsonObject.number(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull
private fun JsonObject.flag(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

/** Напоминания из тела: список минут, либо `null` — «по умолчанию». */
private fun JsonObject.reminders(): List<Int>? =
    (this["reminders"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.intOrNull }

fun mergeEvents(base: List<Event>, ops: List<PendingOp>, iso: String): List<Event> {
    val list = base.toMutableList()
    for (op in ops) {
        if (op.entity != "event") continue
        val body = op.body ?: JsonObject(emptyMap())
        when (op.action) {
            "create" -> {
                if (body.text("date") != iso) continue
                val title = body.text("title").orEmpty()
                val start = body.number("start") ?: 0
                val end = body.number("end") ?: 0
                // Создание уже дошло до сервера, а очередь ещё не дочищена: второй копии не рисуем.
                if (list.any { it.id != op.entityId && it.title == title && it.start == start && it.end == end }) continue
                list += Event(
                    id = op.entityId,
                    date = iso,
                    title = title,
                    subtitle = body.text("subtitle").orEmpty(),
                    start = start,
                    end = end,
                    badge = body.text("badge") ?: "routine",
                    allDay = body.flag("allDay") ?: false,
                    notes = body.text("notes").orEmpty(),
                    url = body.text("url").orEmpty(),
                    repeat = body.text("repeat").orEmpty(),
                    reminders = body.reminders(),
                )
            }
            "update" -> {
                val i = list.indexOfFirst { it.id == op.entityId }
                if (i < 0) continue
                val e = list[i]
                // Перенос на другой день или «убрать этот день из серии» — из списка события уходит.
                val movedAway = body.text("date")?.let { it != iso } == true && e.repeat.isBlank()
                if (movedAway || body.text("skip") == iso) {
                    list.removeAt(i)
                    continue
                }
                list[i] = e.copy(
                    title = body.text("title") ?: e.title,
                    subtitle = body.text("subtitle") ?: e.subtitle,
                    start = body.number("start") ?: e.start,
                    end = body.number("end") ?: e.end,
                    badge = body.text("badge") ?: e.badge,
                    allDay = body.flag("allDay") ?: e.allDay,
                    notes = body.text("notes") ?: e.notes,
                    url = body.text("url") ?: e.url,
                    repeat = body.text("repeat") ?: e.repeat,
                    reminders = when {
                        "reminders" !in body -> e.reminders
                        body["reminders"] is JsonNull -> null
                        else -> body.reminders()
                    },
                )
            }
            "delete" -> list.removeAll { it.id == op.entityId }
        }
    }
    return list.sortedBy { it.start }
}

fun mergeTasks(base: List<Task>, ops: List<PendingOp>): List<Task> {
    val list = base.toMutableList()
    for (op in ops) {
        if (op.entity != "task") continue
        val body = op.body ?: JsonObject(emptyMap())
        val i = list.indexOfFirst { it.id == op.entityId }
        when (op.action) {
            "create" -> list += Task(
                id = op.entityId,
                title = body.text("title").orEmpty(),
                subtitle = body.text("subtitle").orEmpty(),
                kind = body.text("kind") ?: "task",
                category = body.text("category").orEmpty(),
                due = body.text("due").orEmpty(),
                cadence = body.text("cadence").orEmpty(),
                estimate = body.number("estimate") ?: 0,
            )
            "update" -> if (i >= 0) {
                val t = list[i]
                val checked = body.text("check")
                val unchecked = body.text("uncheck")
                list[i] = t.copy(
                    title = body.text("title") ?: t.title,
                    subtitle = body.text("subtitle") ?: t.subtitle,
                    due = body.text("due") ?: t.due,
                    done = body.flag("done") ?: t.done,
                    checks = when {
                        checked != null -> (t.checks + checked).distinct()
                        unchecked != null -> t.checks - unchecked
                        else -> t.checks
                    },
                )
            }
            "delete" -> if (i >= 0) list.removeAt(i)
        }
    }
    return list
}

/** Неотправленным событиям месяца дорисовываем значок — как будто событие уже на сервере. */
fun mergeDots(base: Map<Int, List<String>>, ops: List<PendingOp>, year: Int, month: Int): Map<Int, List<String>> {
    val prefix = "$year-${month.toString().padStart(2, '0')}-"
    val out = base.mapValues { it.value.toMutableList() }.toMutableMap()
    for (op in ops) {
        if (op.entity != "event" || op.action != "create") continue
        val body = op.body ?: continue
        val date = body.text("date") ?: continue
        if (!date.startsWith(prefix)) continue
        val day = date.removePrefix(prefix).toIntOrNull()?.takeIf { it in 1..31 } ?: continue
        val badge = body.text("badge") ?: "routine"
        val badges = out.getOrPut(day) { mutableListOf() }
        if (badge !in badges) badges += badge
    }
    return out
}

/**
 * Последние ответы сервера для работы без сети (на сайте их держит service worker). Лежат в хранилище устройства,
 * поэтому стираются при выходе и смене пользователя.
 */
class ReadCache(private val settings: Settings) {
    private val eventsSerializer = ListSerializer(Event.serializer())
    private val tasksSerializer = ListSerializer(Task.serializer())
    private val dotsSerializer = MapSerializer(Int.serializer(), ListSerializer(String.serializer()))

    fun putEvents(date: String, events: List<Event>) = put("events.$date", apiJson.encodeToString(eventsSerializer, events))
    fun events(date: String): List<Event>? = read("events.$date") { apiJson.decodeFromString(eventsSerializer, it) }

    fun putTasks(tasks: List<Task>) = put("tasks", apiJson.encodeToString(tasksSerializer, tasks))
    fun tasks(): List<Task>? = read("tasks") { apiJson.decodeFromString(tasksSerializer, it) }

    fun putDots(year: Int, month: Int, dots: Map<Int, List<String>>) =
        put("dots.$year-$month", apiJson.encodeToString(dotsSerializer, dots))

    fun dots(year: Int, month: Int): Map<Int, List<String>>? =
        read("dots.$year-$month") { apiJson.decodeFromString(dotsSerializer, it) }

    fun clear() {
        index().forEach { settings.put(PREFIX + it, null) }
        settings.put(INDEX, null)
    }

    private fun put(key: String, json: String) {
        val keys = (index() - key) + key
        // Хранилище устройства не безгранично: держим только свежие дни.
        keys.dropLast(MAX_KEYS).forEach { settings.put(PREFIX + it, null) }
        settings.put(INDEX, keys.takeLast(MAX_KEYS).joinToString("\n"))
        settings.put(PREFIX + key, json)
    }

    private fun <T> read(key: String, decode: (String) -> T): T? =
        settings.get(PREFIX + key)?.let { runCatching { decode(it) }.getOrNull() }

    private fun index(): List<String> = settings.get(INDEX)?.split('\n')?.filter { it.isNotBlank() }.orEmpty()

    private companion object {
        const val PREFIX = "cache."
        const val INDEX = "cache.index"
        const val MAX_KEYS = 60
    }
}
