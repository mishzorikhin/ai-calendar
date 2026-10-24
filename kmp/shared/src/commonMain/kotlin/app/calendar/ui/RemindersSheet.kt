package app.calendar.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendar.CalendarController
import app.calendar.api.NotifySettings
import app.calendar.domain.addedLabel
import app.calendar.domain.alarmPresets
import app.calendar.domain.alarmWhenLabel
import app.calendar.domain.badgeOptions
import app.calendar.domain.dayTimePresets
import app.calendar.domain.decodeQuiet
import app.calendar.domain.encodeQuiet
import app.calendar.domain.localDate
import app.calendar.domain.nextOccurrence
import app.calendar.domain.parseInstant
import app.calendar.domain.pluralize
import app.calendar.domain.quietLabel
import app.calendar.domain.quietPresets
import app.calendar.domain.reminderPresets
import app.calendar.domain.reminderShortLabel
import app.calendar.domain.timeChoiceLabel
import kotlin.time.Clock
import kotlinx.datetime.TimeZone
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val eventChoices = listOf(-1) + reminderPresets
private val taskChoices = listOf(-1) + dayTimePresets.filter { it >= 8 * 60 }
private val digestChoices = listOf(-1) + dayTimePresets.filter { it <= 10 * 60 }
private val eveningChoices = listOf(-1, 19 * 60, 20 * 60, 21 * 60, 22 * 60)
private val quietChoices = listOf(-1) + quietPresets.map { (from, to) -> encodeQuiet(from, to) }

/** −2 — «как обычно»: у типа события нет своего значения. */
private const val AS_USUAL = -2
private val badgeChoices = listOf(AS_USUAL, -1) + reminderPresets

private const val ALARM_TITLE_LIMIT = 200

/** «Напоминания»: уведомления и когда напоминать (для всего аккаунта), свои напоминания, устройства. */
@Composable
fun RemindersSheet(controller: CalendarController) {
    val info = controller.pushInfo
    val settings = info?.settings ?: NotifySettings()
    val zone = TimeZone.currentSystemDefault()
    SheetTitle("Напоминания", onClose = { controller.remindersSheet = false })
    Caption(
        "Уведомления о встречах и сроках задач приходят, даже когда приложение закрыто. " +
            "Шлёт их ваш сервер — без сторонних аккаунтов.",
    )

    DeviceStatus(controller)
    AlarmsSection(controller, zone)

    Caption("Когда напоминать — на всех устройствах")
    ChoiceGroup(
        title = "О встречах",
        hint = "Если у события не задано своё напоминание. И для подключённых календарей",
        options = eventChoices,
        value = settings.eventReminder,
        label = ::reminderShortLabel,
    ) { minutes ->
        controller.setNotify(buildJsonObject { put("eventReminder", minutes) }) { it.copy(eventReminder = minutes) }
    }
    BadgeDefaults(controller, settings)
    ChoiceGroup(
        title = "О задачах и целях",
        hint = "В день срока, если ещё не готово",
        options = taskChoices,
        value = settings.taskTime,
        label = ::timeChoiceLabel,
    ) { minutes ->
        controller.setNotify(buildJsonObject { put("taskTime", minutes) }) { it.copy(taskTime = minutes) }
    }
    ChoiceGroup(
        title = "План на день",
        hint = "Утром: сколько встреч и задач сегодня. В пустой день не приходит",
        options = digestChoices,
        value = settings.digest,
        label = ::timeChoiceLabel,
    ) { minutes ->
        controller.setNotify(buildJsonObject { put("digest", minutes) }) { it.copy(digest = minutes) }
    }
    ChoiceGroup(
        title = "План на завтра",
        hint = "Вечером: что ждёт завтра",
        options = eveningChoices,
        value = settings.evening,
        label = ::timeChoiceLabel,
    ) { minutes ->
        controller.setNotify(buildJsonObject { put("evening", minutes) }) { it.copy(evening = minutes) }
    }
    ChoiceGroup(
        title = "Тихие часы",
        hint = "Ничего не приходит, кроме напоминаний, заданных у события явно, и своих напоминаний",
        options = quietChoices,
        value = encodeQuiet(settings.quietFrom, settings.quietTo),
        label = ::quietLabel,
    ) { code ->
        val (from, to) = decodeQuiet(code)
        controller.setNotify(buildJsonObject { put("quietFrom", from); put("quietTo", to) }) {
            it.copy(quietFrom = from, quietTo = to)
        }
    }

    DevicesList(controller, zone)
}

/** Группа вариантов одной настройки — «таблетки» в ряд. Значение не из списка тоже показывается выбранным. */
@Composable
private fun ChoiceGroup(
    title: String,
    hint: String?,
    options: List<Int>,
    value: Int,
    label: (Int) -> String,
    onChange: (Int) -> Unit,
) {
    val list = if (value in options) options else (options + value).sorted()
    Text(title, fontSize = 16.sp, color = MaterialTheme.colorScheme.onSurface)
    if (hint != null) Caption(hint)
    ChoiceRow {
        list.forEach { v ->
            ChoicePill(label(v), selected = v == value, reveal = v == value) { if (v != value) onChange(v) }
        }
    }
}

/** «Своё время для типов событий»: спорт — за час, работа — за 15 минут… */
@Composable
private fun BadgeDefaults(controller: CalendarController, settings: NotifySettings) {
    val own = settings.badgeReminders
    var open by rememberSaveable { mutableStateOf(own.isNotEmpty()) }
    Text(
        (if (open) "▾ " else "▸ ") + "Своё время для типов событий",
        modifier = Modifier.pressable(role = Role.Button) { open = !open }
            .fillMaxWidth()
            .defaultMinSize(minHeight = 44.dp)
            .padding(vertical = 10.dp),
        fontSize = 15.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    if (!open) return
    badgeOptions.forEach { badge ->
        ChoiceGroup(
            title = badge.label,
            hint = null,
            options = badgeChoices,
            value = own[badge.id] ?: AS_USUAL,
            label = { if (it == AS_USUAL) "Как обычно" else reminderShortLabel(it) },
        ) { minutes ->
            val next = if (minutes == AS_USUAL) own - badge.id else own + (badge.id to minutes)
            // Сервер заменяет весь список «тип → минуты»; пустой объект сбрасывает его.
            val json = JsonObject(next.mapValues { JsonPrimitive(it.value) })
            controller.setNotify(buildJsonObject { put("badgeReminders", json) }) { it.copy(badgeReminders = next) }
        }
    }
}

/** Сколько устройств получает уведомления, проверка доставки и подсказка, как включить на телефоне. */
@Composable
private fun DeviceStatus(controller: CalendarController) {
    val devices = controller.pushInfo?.devices ?: 0
    val sent = controller.testSent
    val note = when {
        sent != null -> "Отправили на ${pluralize(sent, "устройство", "устройства", "устройств")} — сейчас придёт"
        devices > 0 -> "Включены на ${pluralize(devices, "устройстве", "устройствах", "устройствах")}"
        else -> "Сейчас выключены"
    }
    Text(note, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurface)
    Caption(
        "Включить уведомления на телефоне или компьютере можно в веб-версии (на iPhone — после «На экран „Домой“»). " +
            "Это приложение пока не принимает push.",
    )
    if (devices > 0) ActionPill("Проверить") { controller.testPush() }
}

/** Свои напоминания без события: «Позвонить маме» + когда. Ниже — те, что ещё не пришли. */
@Composable
private fun AlarmsSection(controller: CalendarController, zone: TimeZone) {
    var text by rememberSaveable { mutableStateOf("") }
    var missing by rememberSaveable { mutableStateOf(false) }
    val now = Clock.System.now()

    Caption("Напомнить без события")
    SheetField(text, { text = it.take(ALARM_TITLE_LIMIT); missing = false }, "О чём, например «Позвонить маме»", last = true)
    Caption(if (missing) "Сначала напишите, о чём напомнить" else "И выберите когда:")
    fun add(at: kotlin.time.Instant) {
        val value = text.trim()
        if (value.isEmpty()) {
            missing = true
            return
        }
        controller.createAlarm(value, at.toString()) { text = "" }
    }
    ChoiceRow {
        alarmPresets(now, zone).forEach { preset -> ChoicePill(preset.label, selected = false) { add(preset.at) } }
    }
    ChoiceRow {
        listOf(8, 9, 12, 15, 18, 20, 21).forEach { hour ->
            ChoicePill("В $hour:00", selected = false) { add(nextOccurrence(now, zone, hour * 60)) }
        }
    }

    controller.alarms.forEach { alarm ->
        val at = parseInstant(alarm.at)
        Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.foundation.layout.Column(Modifier.weight(1f)) {
                Text(
                    if (alarm.kind == "reminder") alarm.text else "Отложено: ${alarm.text}",
                    fontSize = 15.sp,
                    maxLines = 2,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                if (at != null) Caption(alarmWhenLabel(at, now, zone))
            }
            Text(
                "Отменить",
                modifier = Modifier.pressable(role = Role.Button, onClickLabel = "Отменить напоминание «${alarm.text}»") {
                    controller.deleteAlarm(alarm.id)
                }.padding(12.dp),
                color = MaterialTheme.colorScheme.error,
                fontSize = 14.sp,
            )
        }
    }
}

/** Устройства с уведомлениями: старый телефон можно отключить отсюда. */
@Composable
private fun DevicesList(controller: CalendarController, zone: TimeZone) {
    if (controller.pushDevices.isEmpty()) return
    val today = localDate(Clock.System.now(), zone)
    Caption("Устройства с уведомлениями")
    controller.pushDevices.forEach { device ->
        val added = parseInstant(device.createdAt)?.let { addedLabel(localDate(it, zone), today) }
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            androidx.compose.foundation.layout.Column(Modifier.weight(1f)) {
                Text(device.label.ifBlank { "Неизвестное устройство" }, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurface)
                if (added != null) Caption("добавлено $added")
            }
            Text(
                "Отключить",
                modifier = Modifier.pressable(role = Role.Button, onClickLabel = "Отключить ${device.label}") {
                    controller.deletePushDevice(device.id)
                }.padding(12.dp),
                color = MaterialTheme.colorScheme.error,
                fontSize = 14.sp,
            )
        }
    }
}
