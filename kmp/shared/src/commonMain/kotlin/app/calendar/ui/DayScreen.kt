package app.calendar.ui

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
                    onOpen = { open = part.name },
                    onEvent = { controller.openEvent(it, date) },
                    modifier = if (expanded) Modifier.weight(1f) else Modifier.height(if (controller.dayTimeline) 72.dp else 0.dp),
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

@Composable
private fun PartLayer(
    part: DayPart,
    events: List<Event>,
    expanded: Boolean,
    list: Boolean,
    onOpen: () -> Unit,
    onEvent: (Event) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (list) return
    val dark = platformInDarkTheme()
    // Подписи на градиентах: светлый градиент — тёмные чернила, тёмный — светлые.
    val soft = (if (dark) Color.White else Color(0xFF0D0D10)).copy(alpha = 0.7f)
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
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(30.dp))
            .background(brush)
            .clickable(role = Role.Button, onClick = onOpen)
            .padding(horizontal = 18.dp, vertical = 14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(part.title, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            if (!expanded && events.isNotEmpty()) {
                Text(pluralize(events.size, "событие", "события", "событий"), color = soft, fontSize = 14.sp)
            }
        }
        if (expanded) {
            Column(Modifier.padding(top = 8.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                events.sortedBy { it.start }.forEach { event ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(formatMinutes(event.start), modifier = Modifier.padding(end = 10.dp), color = soft, fontSize = 12.sp)
                        EventCard(event) { onEvent(event) }
                    }
                }
                if (events.isEmpty()) Text("Пусто", color = soft)
            }
        }
    }
}

@Composable
private fun EventCard(event: Event, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(event.title.ifBlank { "Без названия" }, fontWeight = FontWeight.SemiBold)
            if (event.subtitle.isNotBlank()) {
                Text(event.subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
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
    submit: String = "Создать",
    onSave: (title: String, start: Int, end: Int, badge: String, allDay: Boolean, notes: String) -> Unit,
) {
    var title by rememberSaveable { mutableStateOf(initial?.title.orEmpty()) }
    var start by rememberSaveable { mutableStateOf(initial?.takeIf { !it.allDay }?.start ?: (10 * 60)) }
    var length by rememberSaveable {
        mutableStateOf(initial?.takeIf { !it.allDay && it.end > it.start }?.let { it.end - it.start } ?: 60)
    }
    var badge by rememberSaveable { mutableStateOf(initial?.badge ?: "routine") }
    var allDay by rememberSaveable { mutableStateOf(initial?.allDay ?: false) }
    var notes by rememberSaveable { mutableStateOf(initial?.notes.orEmpty()) }
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
        Box(
            Modifier
                .fillMaxWidth()
                .height(54.dp)
                .clip(CircleShape)
                .background(if (title.isNotBlank()) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
                .clickable(enabled = title.isNotBlank(), role = Role.Button) {
                    onSave(title, start, (start + length).coerceAtMost(24 * 60), badge, allDay, notes)
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

private fun lengthLabel(minutes: Int): String = when {
    minutes < 60 -> "$minutes мин"
    minutes % 60 == 0 -> "${minutes / 60} ч"
    minutes == 90 -> "1,5 ч"
    else -> "${minutes / 60} ч ${minutes % 60} мин"
}
