package app.calendar.ui

import kotlinx.datetime.toLocalDateTime
import kotlinx.datetime.TimeZone
import kotlin.time.Clock
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.Spacer
import app.calendar.domain.reminderShortLabel
import app.calendar.domain.reminderPresets
import app.calendar.domain.parseLogins
import app.calendar.api.EventExtras
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendar.CalendarController
import app.calendar.Screen
import app.calendar.api.Event
import app.calendar.domain.DayPart
import app.calendar.domain.badgeLabel
import app.calendar.domain.formatMinutes
import app.calendar.domain.monthGenitive
import app.calendar.domain.partOf
import app.calendar.domain.pluralize
import app.calendar.domain.weekdayName
import app.calendar.domain.weekdayShort
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.plus

private val badges = listOf("routine", "work", "food", "sport", "read", "sleep")
/** Начало — каждые полчаса, в течение всех суток. */
private val starts = (0 until 48).map { it * 30 }

@Composable
fun DayModeSwitch(timeline: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(999.dp)).background(barInk(platformInDarkTheme()).copy(alpha = 0.12f)).padding(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        ModeKnob("Шкала", timeline) { onChange(true) }
        ModeKnob("Список", !timeline) { onChange(false) }
    }
}

@Composable
private fun ModeKnob(label: String, on: Boolean, click: () -> Unit) {
    Box(
        Modifier
            .defaultMinSize(minHeight = 44.dp)
            .clip(CircleShape)
            .background(if (on) MaterialTheme.colorScheme.surface else Color.Transparent)
            .clickable(role = Role.Tab, onClick = click)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 13.sp, color = if (on) MaterialTheme.colorScheme.onSurface else barInk(platformInDarkTheme())) }
}

@Composable
fun DayScreen(controller: CalendarController, date: LocalDate) {
    var open by rememberSaveable { mutableStateOf(DayPart.Morning.name) }
    val events = controller.dayEvents.filter { !it.allDay }
    val now = Clock.System.now().toLocalDateTime(TimeZone.currentSystemDefault())
    val nowMinutes = (now.hour * 60 + now.minute).takeIf { date == controller.today() }
    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(
                    weekdayName(date),
                    fontSize = 40.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-1).sp,
                    lineHeight = 42.sp,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    "${date.dayOfMonth} ${monthGenitive(date)}",
                    fontSize = 40.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    letterSpacing = (-1).sp,
                    lineHeight = 42.sp,
                )
            }
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surface)
                    .clickable(role = Role.Button, onClickLabel = "Закрыть день") { controller.back() },
                contentAlignment = Alignment.Center,
            ) { CloseIcon(size = 20.dp) }
        }
        val allDayEvents = controller.dayEvents.filter { it.allDay }
        if (allDayEvents.isNotEmpty()) {
            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                allDayEvents.forEach { event -> EventCard(event) { controller.openEvent(event, date) } }
            }
        }
        Column(Modifier.weight(1f).padding(top = 12.dp)) {
            DayPart.entries.forEach { part ->
                val slice = events.filter { partOf(it.start) == part }
                val expanded = controller.dayTimeline && open == part.name
                PartLayer(
                    part = part,
                    events = slice,
                    expanded = expanded,
                    list = !controller.dayTimeline,
                    nowMinutes = nowMinutes,
                    onOpen = { open = part.name },
                    onEvent = { controller.openEvent(it, date) },
                    onCreate = { start -> controller.compose(date, start) },
                    modifier = if (expanded) Modifier.weight(1f) else Modifier.height(if (controller.dayTimeline) 58.dp else 0.dp),
                )
            }
            if (!controller.dayTimeline) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    events.sortedBy { it.start }.forEach { event ->
                        EventCard(event) { controller.openEvent(event, date) }
                    }
                }
            }
        }
        WeekStrip(date) { controller.open(Screen.Day(it)) }
    }
}

private val hourHeight = 62.dp

private fun partRange(part: DayPart): Pair<Int, Int> = when (part) {
    DayPart.Morning -> 6 * 60 to 12 * 60
    DayPart.Afternoon -> 12 * 60 to 18 * 60
    DayPart.Night -> 18 * 60 to 24 * 60
}

@Composable
private fun PartLayer(
    part: DayPart,
    events: List<Event>,
    expanded: Boolean,
    list: Boolean,
    nowMinutes: Int?,
    onOpen: () -> Unit,
    onEvent: (Event) -> Unit,
    onCreate: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (list) return
    val dark = platformInDarkTheme()
    // Как на сайте: «Вечер» на сером градиенте — белыми чернилами, остальное — тёмными (в тёмной теме — светлыми).
    val ink = if (dark || part == DayPart.Night) Color.White else Color(0xFF0D0D10)
    val soft = ink.copy(alpha = if (part == DayPart.Night) 0.8f else 0.65f)
    val brush = when (part) {
        DayPart.Morning -> if (dark) {
            Brush.verticalGradient(listOf(Color(0xFF24361F), Color(0xFF1B211B), Color(0xFF19191F)))
        } else {
            Brush.verticalGradient(listOf(Color(0xFFD6ECC2), Color(0xFFE9F4DE), Color(0xFFF7FAF3)))
        }
        DayPart.Afternoon -> if (dark) {
            Brush.verticalGradient(listOf(Color(0xFF232A36), Color(0xFF1D232E)))
        } else {
            Brush.verticalGradient(listOf(Color(0xFFE3E9F2), Color(0xFFD2DBE8)))
        }
        DayPart.Night -> if (dark) {
            Brush.verticalGradient(listOf(Color(0xFF2C3242), Color(0xFF262B39), Color(0xFF212531)))
        } else {
            Brush.verticalGradient(listOf(Color(0xFF7F8A9B), Color(0xFFA3ADBC), Color(0xFFB8C0CC)))
        }
    }
    val (partFrom, to) = partRange(part)
    // Ночные события (до 6 утра) относятся к утру: шкала утра начинается с часа самого раннего из них.
    val from = minOf(partFrom, events.minOfOrNull { it.start / 60 * 60 } ?: partFrom)
    val hours = (to - from) / 60
    val nowInside = nowMinutes != null && nowMinutes >= from && nowMinutes < to
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(30.dp)),
    ) {
        Column(Modifier.fillMaxSize().background(brush)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = 58.dp)
                    .clickable(role = Role.Button, onClickLabel = if (expanded) null else "Раскрыть") { onOpen() }
                    .padding(start = 20.dp, end = 18.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(part.title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.4).sp, color = ink)
                if (!expanded && events.isNotEmpty()) {
                    Text(pluralize(events.size, "событие", "события", "событий"), color = soft, fontSize = 12.5.sp)
                }
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier
                        .size(24.dp)
                        .clip(CircleShape)
                        .background(
                            when (part) {
                                DayPart.Morning -> Color(0xFF4CC46D)
                                DayPart.Afternoon -> Color(0xFFF5C445)
                                DayPart.Night -> Color.White.copy(alpha = 0.28f)
                            },
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    if (part == DayPart.Night) MoonIcon(size = 14.dp, color = Color.White) else SunIcon(size = 14.dp, color = Color.White)
                }
            }
            if (expanded) {
                val scroll = rememberScrollState()
                val density = LocalDensity.current
                LaunchedEffect(nowInside) {
                    if (nowInside && nowMinutes != null) {
                        val target = with(density) { (hourHeight * ((nowMinutes - from) / 60f) - 80.dp).toPx() }
                        scroll.animateScrollTo(target.toInt().coerceAtLeast(0))
                    }
                }
                Column(Modifier.weight(1f).verticalScroll(scroll).padding(end = 12.dp, bottom = 18.dp)) {
                    Box(
                        Modifier
                            .padding(top = 8.dp)
                            .fillMaxWidth()
                            .height(hourHeight * hours)
                            // Нажатие на пустое место шкалы — новое событие на это время (шаг 30 минут).
                            .pointerInput(from, hours) {
                                detectTapGestures { tap ->
                                    val minutes = from + (tap.y / hourHeight.toPx() * 2).toInt() * 30
                                    onCreate(minutes.coerceIn(from, to - 30))
                                }
                            },
                    ) {
                        repeat(hours) { h ->
                            Text(
                                formatMinutes(from + h * 60),
                                modifier = Modifier.padding(start = 18.dp).offset(y = hourHeight * h - 2.dp),
                                fontSize = 11.5.sp,
                                color = soft,
                            )
                        }
                        events.sortedBy { it.start }.forEach { event ->
                            val start = maxOf(event.start, from)
                            val end = minOf(event.end, to)
                            val top = hourHeight * ((start - from) / 60f) + 3.dp
                            val height = maxOf(hourHeight * ((end - start) / 60f) - 6.dp, 44.dp)
                            EventCard(
                                event,
                                Modifier.padding(start = 68.dp).offset(y = top).height(height),
                            ) { onEvent(event) }
                        }
                        if (nowInside && nowMinutes != null) {
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(start = 8.dp)
                                    .offset(y = hourHeight * ((nowMinutes - from) / 60f) - 9.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    formatMinutes(nowMinutes),
                                    modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Color(0xFFFF3B55)).padding(horizontal = 6.dp, vertical = 2.dp),
                                    color = Color.White,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Box(Modifier.padding(start = 4.dp).weight(1f).height(2.dp).clip(RoundedCornerShape(1.dp)).background(Color(0xFFFF3B55)))
                            }
                        }
                    }
                    Row(
                        Modifier
                            .padding(start = 60.dp, top = 6.dp)
                            .defaultMinSize(minHeight = 44.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .clickable(role = Role.Button) { onCreate(firstFreeTime(events, from, to)) }
                            .padding(horizontal = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PlusIcon(size = 15.dp, color = soft)
                        Text(" Добавить событие · или нажмите на свободное время", color = soft, fontSize = 12.5.sp)
                    }
                }
            }
        }
    }
}

/** Первое свободное получасовое окно в слое, иначе его начало. */
private fun firstFreeTime(events: List<Event>, from: Int, to: Int): Int {
    var t = from
    while (t < to - 30) {
        if (events.none { it.start < t + 30 && it.end > t }) return t
        t += 30
    }
    return from
}

@Composable
private fun EventCard(event: Event, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(event.title.ifBlank { "Без названия" }, fontWeight = FontWeight.SemiBold)
            val sub = event.subtitle.ifBlank {
                event.invite?.let { "от @${it.from.username}" }.orEmpty()
            }
            if (sub.isNotBlank()) {
                Text(sub, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, maxLines = 1)
            }
        }
        Box(Modifier.size(10.dp).clip(CircleShape).background(badgeColor(event.badge)))
    }
}

@Composable
private fun WeekStrip(selected: LocalDate, onSelect: (LocalDate) -> Unit) {
    val start = selected.plus(DatePeriod(days = -(selected.dayOfWeek.isoDayNumber - 1)))
    Row(
        Modifier
            .padding(vertical = 8.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 6.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        val dark = platformInDarkTheme()
        (0 until 7).forEach { offset ->
            val day = start.plus(DatePeriod(days = offset))
            val on = day == selected
            Column(
                Modifier.clip(CircleShape).clickable { onSelect(day) }.padding(horizontal = 6.dp, vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    weekdayShort(day),
                    fontSize = 12.sp,
                    color = if (offset >= 5) weekendColor(dark) else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Box(
                    Modifier.padding(top = 2.dp).size(32.dp).clip(CircleShape).background(if (on) MaterialTheme.colorScheme.primary else Color.Transparent),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        day.dayOfMonth.toString(),
                        color = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }
}

/** Редактор события: без [initial] — создание, с ним — правка. */
@Composable
fun EventEditor(
    initial: Event? = null,
    defaultStart: Int? = null,
    submit: String = "Создать",
    onSave: (title: String, start: Int, end: Int, badge: String, allDay: Boolean, notes: String, extras: EventExtras) -> Unit,
) {
    var title by rememberSaveable { mutableStateOf(initial?.title.orEmpty()) }
    var start by rememberSaveable { mutableStateOf(initial?.takeIf { !it.allDay }?.start ?: defaultStart ?: (10 * 60)) }
    var length by rememberSaveable {
        mutableStateOf(initial?.takeIf { !it.allDay && it.end > it.start }?.let { it.end - it.start } ?: 60)
    }
    var badge by rememberSaveable { mutableStateOf(initial?.badge ?: "routine") }
    var allDay by rememberSaveable { mutableStateOf(initial?.allDay ?: false) }
    var notes by rememberSaveable { mutableStateOf(initial?.notes.orEmpty()) }
    var repeat by rememberSaveable { mutableStateOf(initial?.repeat.orEmpty()) }
    var url by rememberSaveable { mutableStateOf(initial?.url.orEmpty()) }
    var guests by rememberSaveable { mutableStateOf(initial?.attendees.orEmpty().joinToString(" ") { "@${it.username}" }) }
    // null — напоминание по умолчанию из настроек, -1 — не напоминать.
    var reminder by rememberSaveable { mutableStateOf<Int?>(initial?.reminders?.let { it.firstOrNull() ?: -1 }) }
    var reminderTouched by rememberSaveable { mutableStateOf(false) }
    // Нестандартные время и длительность из события не теряются: добавляем их в список выбора.
    val startOptions = (starts + start).distinct().sorted()
    val lengthOptions = (listOf(30, 60, 90, 120, 180) + length).distinct().sorted()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SheetField(title, { title = it }, "Название")
        SheetField(notes, { notes = it }, "Заметка — необязательно")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Весь день", modifier = Modifier.weight(1f))
            Switch(checked = allDay, onCheckedChange = { allDay = it })
        }
        if (!allDay) {
            Text("Начало", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            ChoiceRow(focusIndex = startOptions.indexOf(start)) {
                startOptions.forEach { value -> ChoicePill(formatMinutes(value), value == start) { start = value } }
            }
            Text("Длительность", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            ChoiceRow {
                lengthOptions.forEach { value ->
                    ChoicePill(lengthLabel(value), value == length) { length = value }
                }
            }
        }
        Text("Тип", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        ChoiceRow {
            badges.forEach { value -> ChoicePill(badgeLabel(value), value == badge) { badge = value } }
        }
        Text("Повтор", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        ChoiceRow {
            repeats.forEach { (value, label) -> ChoicePill(label, value == repeat) { repeat = value } }
        }
        if (!allDay) {
            Text("Напомнить", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            ChoiceRow {
                ChoicePill("Как в настройках", reminder == null) {
                    reminder = null
                    reminderTouched = true
                }
                (listOf(-1) + reminderPresets).forEach { value ->
                    ChoicePill(reminderShortLabel(value), reminder == value) {
                        reminder = value
                        reminderTouched = true
                    }
                }
            }
        }
        SheetField(guests, { guests = it }, "Позвать: @логины через пробел")
        SheetField(url, { url = it }, "Ссылка — необязательно")
        Box(
            Modifier
                .fillMaxWidth()
                .height(54.dp)
                .clip(CircleShape)
                .background(if (title.isNotBlank()) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
                .clickable(enabled = title.isNotBlank(), role = Role.Button) {
                    val logins = parseLogins(guests)
                    val before = initial?.attendees.orEmpty().map { it.username }
                    onSave(
                        title,
                        start,
                        (start + length).coerceAtMost(24 * 60),
                        badge,
                        allDay,
                        notes,
                        EventExtras(
                            repeat = if (initial == null) repeat.ifBlank { null } else repeat.takeIf { it != initial.repeat },
                            attendees = if (initial == null) logins.takeIf { it.isNotEmpty() } else logins.takeIf { it != before },
                            url = if (initial == null) url.ifBlank { null } else url.takeIf { it != initial.url },
                            reminder = reminder,
                            reminderTouched = reminderTouched,
                        ),
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                submit,
                color = if (title.isNotBlank()) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

private val repeats = listOf(
    "" to "Не повторять",
    "daily" to "Каждый день",
    "weekdays" to "По будням",
    "weekly" to "Каждую неделю",
    "monthly" to "Каждый месяц",
    "yearly" to "Каждый год",
)

private fun lengthLabel(minutes: Int): String = when {
    minutes < 60 -> "$minutes мин"
    minutes % 60 == 0 -> "${minutes / 60} ч"
    minutes == 90 -> "1,5 ч"
    else -> "${minutes / 60} ч ${minutes % 60} мин"
}
