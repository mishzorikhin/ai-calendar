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
    var pendingDelete by rememberSaveable { mutableStateOf<String?>(null) }
    val events = controller.dayEvents.filter { !it.allDay }
    val victim = events.firstOrNull { it.id == pendingDelete }
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
                    onEvent = { pendingDelete = it.id },
                    modifier = if (expanded) Modifier.weight(1f) else Modifier.height(if (controller.dayTimeline) 72.dp else 0.dp),
                )
            }
            if (!controller.dayTimeline) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    events.sortedBy { it.start }.forEach { event ->
                        EventCard(event) { pendingDelete = event.id }
                    }
                }
            }
        }
        WeekStrip(date) { controller.open(Screen.Day(it)) }
    }
    if (victim != null) {
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text(if (victim.readOnly) "Только просмотр" else "Удалить «${victim.title.ifBlank { "Без названия" }}»?") },
            text = { Text("${formatRange(victim.start, victim.end, victim.allDay)} · ${badgeLabel(victim.badge)}") },
            confirmButton = {
                if (!victim.readOnly) {
                    TextButton(onClick = {
                        controller.deleteEvent(victim, date)
                        pendingDelete = null
                    }) { Text("Удалить") }
                }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("Оставить") } },
        )
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

@Composable
fun EventEditor(onSave: (title: String, start: Int, end: Int, badge: String, allDay: Boolean) -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var start by rememberSaveable { mutableStateOf(10 * 60) }
    var length by rememberSaveable { mutableStateOf(60) }
    var badge by rememberSaveable { mutableStateOf("routine") }
    var allDay by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SheetField(title, { title = it }, "Название")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Весь день", modifier = Modifier.weight(1f))
            Switch(checked = allDay, onCheckedChange = { allDay = it })
        }
        if (!allDay) {
            Text("Начало", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            ChoiceRow(focusIndex = starts.indexOf(start)) {
                starts.forEach { value -> ChoicePill(formatMinutes(value), value == start) { start = value } }
            }
            Text("Длительность", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            ChoiceRow {
                listOf(30 to "30 мин", 60 to "1 ч", 90 to "1,5 ч", 120 to "2 ч", 180 to "3 ч").forEach { (value, label) ->
                    ChoicePill(label, value == length) { length = value }
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
                    onSave(title, start, (start + length).coerceAtMost(24 * 60), badge, allDay)
                },
            contentAlignment = Alignment.Center,
        ) {
            Text("Создать", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Medium)
        }
    }
}
