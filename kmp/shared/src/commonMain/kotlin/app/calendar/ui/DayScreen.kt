package app.calendar.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.animateColorAsState
import kotlinx.datetime.toLocalDateTime
import kotlinx.datetime.TimeZone
import kotlin.time.Clock
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import app.calendar.domain.parseIsoDate
import app.calendar.domain.dayTitle
import app.calendar.domain.isoDate
import app.calendar.domain.conflictWith
import app.calendar.domain.suggestStart
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
import androidx.compose.foundation.layout.width
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
import app.calendar.domain.formatRange
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.Orientation
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
    val bounds = rememberKnobBounds()
    val haptics = rememberHaptics()
    Box(
        Modifier.then(bounds.container()).clip(RoundedCornerShape(999.dp)).background(barInk(platformInDarkTheme()).copy(alpha = 0.12f)),
    ) {
        SlidingKnob(bounds, if (timeline) 0 else 1, MaterialTheme.colorScheme.surface, CircleShape)
        Row(Modifier.padding(2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            ModeKnob("Шкала", timeline, bounds.item(0), { c -> TimelineIcon(size = 16.dp, color = c) }) { if (!timeline) haptics.tick(); onChange(true) }
            ModeKnob("Список", !timeline, bounds.item(1), { c -> AgendaIcon(size = 16.dp, color = c) }) { if (timeline) haptics.tick(); onChange(false) }
        }
    }
}

@Composable
private fun ModeKnob(label: String, on: Boolean, modifier: Modifier, icon: @Composable (Color) -> Unit, click: () -> Unit) {
    val ink = if (on) MaterialTheme.colorScheme.onSurface else barInk(platformInDarkTheme())
    Column(
        modifier.pressable(role = Role.Tab, onClick = click)
            .defaultMinSize(minHeight = 44.dp)
            .padding(horizontal = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        icon(ink)
        Text(label, fontSize = 11.sp, lineHeight = 13.sp, color = ink)
    }
}

@Composable
fun DayScreen(controller: CalendarController, date: LocalDate) {
    val haptics = rememberHaptics()
    val events = controller.dayEvents.filter { !it.allDay }
    val now = Clock.System.now().toLocalDateTime(TimeZone.currentSystemDefault())
    val nowMinutes = (now.hour * 60 + now.minute).takeIf { date == controller.today() }
    // Как на сайте: сегодня раскрыт текущий слой суток, в другие дни — утро.
    val open = controller.dayOpenPart ?: (nowMinutes?.let(::partOf) ?: DayPart.Morning).name
    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 8.dp).appear(0), verticalAlignment = Alignment.Top) {
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
                Modifier.pressable(role = Role.Button, onClickLabel = "Закрыть день") { controller.back() }
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surface),
                contentAlignment = Alignment.Center,
            ) { CloseIcon(size = 20.dp) }
        }
        val allDayEvents = controller.dayEvents.filter { it.allDay }
        if (allDayEvents.isNotEmpty()) {
            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                allDayEvents.forEachIndexed { i, event -> EventCard(event, Modifier.appear(i, dy = 14.dp, scaleFrom = 0.97f)) { controller.openEvent(event, date) } }
            }
        }
        var swipe by remember { mutableFloatStateOf(0f) }
        BoxWithConstraints(
            Modifier.weight(1f).padding(top = 12.dp).appear(1)
                // Свайп в сторону — предыдущий или следующий день, как лента недели.
                .draggable(
                    orientation = Orientation.Horizontal,
                    state = rememberDraggableState { swipe += it },
                    onDragStopped = { velocity ->
                        val moved = swipe
                        swipe = 0f
                        val delta = when {
                            moved < -110f || velocity < -1100f -> 1
                            moved > 110f || velocity > 1100f -> -1
                            else -> 0
                        }
                        if (delta != 0) {
                            haptics.tick()
                            controller.open(Screen.Day(date.plus(DatePeriod(days = delta))))
                        }
                    },
                ),
        ) {
            val collapsed = 58.dp
            val expandedHeight = maxHeight - collapsed * (DayPart.entries.size - 1)
            Column(Modifier.fillMaxSize()) {
                DayPart.entries.forEach { part ->
                    val slice = events.filter { partOf(it.start) == part }
                    val expanded = controller.dayTimeline && open == part.name
                    // Слои раскрываются пружиной: высота — явная, а не weight, который не анимируется.
                    val height by animateDpAsState(
                        when {
                            !controller.dayTimeline -> 0.dp
                            expanded -> expandedHeight
                            else -> collapsed
                        },
                        uiSpring(),
                        label = "part",
                    )
                    PartLayer(
                        part = part,
                        events = slice,
                        expanded = expanded,
                        list = !controller.dayTimeline,
                        nowMinutes = nowMinutes,
                        onOpen = { if (open != part.name) haptics.tick(); controller.dayOpenPart = part.name },
                        onEvent = { controller.openEvent(it, date) },
                        onCreate = { start -> controller.compose(date, start) },
                        modifier = Modifier.height(height.coerceAtLeast(0.dp)),
                    )
                }
                if (!controller.dayTimeline) {
                    Agenda(events, Modifier.weight(1f)) { controller.openEvent(it, date) }
                }
            }
        }
        WeekStrip(date, Modifier.appear(2)) { controller.open(Screen.Day(it)) }
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
                Modifier.pressable(role = Role.Button, onClickLabel = if (expanded) null else "Раскрыть") { onOpen() }
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = 58.dp)
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
                            // Прошедшие часы приглушены, чтобы взгляд шёл к тому, что впереди.
                            val past = nowMinutes != null && from + h * 60 + 60 <= nowMinutes
                            Text(
                                formatMinutes(from + h * 60),
                                modifier = Modifier.padding(start = 18.dp).offset(y = hourHeight * h - 2.dp),
                                fontSize = 11.5.sp,
                                color = if (past) soft.copy(alpha = soft.alpha * 0.55f) else soft,
                            )
                        }
                        events.sortedBy { it.start }.forEachIndexed { index, event ->
                            val start = maxOf(event.start, from)
                            val end = minOf(event.end, to)
                            val top = hourHeight * ((start - from) / 60f) + 3.dp
                            val height = maxOf(hourHeight * ((end - start) / 60f) - 6.dp, 52.dp)
                            EventCard(
                                event,
                                Modifier
                                    .padding(start = 68.dp)
                                    .offset(y = top)
                                    .height(height)
                                    .appear(index, dy = 14.dp, startDelay = 150, step = 60, scaleFrom = 0.97f),
                                compact = true,
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
                        Modifier.pressable(role = Role.Button) { onCreate(firstFreeTime(events, from, to)) }
                            .padding(start = 60.dp, top = 6.dp)
                            .defaultMinSize(minHeight = 44.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .padding(horizontal = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PlusIcon(size = 15.dp, color = soft)
                        Text(" Добавить событие", color = soft, fontSize = 12.5.sp)
                    }
                }
            }
        }
    }
}

/** «Список» как `Agenda.tsx`: слои суток с заголовками, время слева, цветная полоска, название и место. */
@Composable
private fun Agenda(events: List<Event>, modifier: Modifier = Modifier, onEvent: (Event) -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(30.dp))
            .background(MaterialTheme.colorScheme.surface)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 14.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (events.isEmpty()) {
            Text("В этот день событий нет", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp))
        }
        var index = 0
        DayPart.entries.forEach { part ->
            val slice = events.filter { partOf(it.start) == part }.sortedBy { it.start }
            if (slice.isEmpty()) return@forEach
            Text(part.title, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp, top = 4.dp))
            slice.forEach { event ->
                val i = index++
                Row(
                    Modifier.appear(i, dy = 12.dp, startDelay = 40, step = 40, scaleFrom = 0.97f)
                        .pressable(onClick = { onEvent(event) })
                        .semantics { contentDescription = eventDescription(event) }
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Column(Modifier.width(56.dp)) {
                        Text(formatMinutes(event.start), fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, softWrap = false)
                        Text(formatMinutes(event.end), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Box(Modifier.width(3.dp).height(34.dp).clip(RoundedCornerShape(2.dp)).background(badgeColor(event.badge)))
                    Column(Modifier.weight(1f)) {
                        Text(event.title.ifBlank { "Без названия" }, fontWeight = FontWeight.SemiBold, maxLines = 1)
                        val sub = event.subtitle.ifBlank { event.invite?.let { "от @${it.from.username}" }.orEmpty() }
                        if (sub.isNotBlank()) Text(sub, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, maxLines = 1)
                    }
                }
            }
        }
    }
}

/** Для скринридера: «Планёрка, 10:00–11:00, Офис». */
private fun eventDescription(event: Event): String = buildList {
    add(event.title.ifBlank { "Без названия" })
    add(formatRange(event.start, event.end, event.allDay))
    if (event.subtitle.isNotBlank()) add(event.subtitle)
}.joinToString(", ")

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
private fun EventCard(event: Event, modifier: Modifier = Modifier, compact: Boolean = false, onClick: () -> Unit) {
    Row(
        modifier.pressable(onClick = onClick)
            .semantics { contentDescription = eventDescription(event) }
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 14.dp, vertical = if (compact) 6.dp else 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (event.repeat.isNotBlank()) RepeatIcon(size = 12.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (event.url.isNotBlank()) VideoIcon(size = 12.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(event.title.ifBlank { "Без названия" }, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
            val sub = event.subtitle.ifBlank {
                event.invite?.let { "от @${it.from.username}" }.orEmpty()
            }
            if (sub.isNotBlank()) {
                Text(sub, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, maxLines = 1)
            }
        }
        Box(
            Modifier.size(18.dp).clip(CircleShape).background(badgeColor(event.badge)),
            contentAlignment = Alignment.Center,
        ) { BadgeIcon(event.badge, size = 10.dp, color = Color.White) }
    }
}

@Composable
private fun WeekStrip(selected: LocalDate, modifier: Modifier = Modifier, onSelect: (LocalDate) -> Unit) {
    val start = selected.plus(DatePeriod(days = -(selected.dayOfWeek.isoDayNumber - 1)))
    // Свайп по ленте листает недели, как на сайте.
    var finger by remember { mutableFloatStateOf(0f) }
    val bounds = rememberKnobBounds()
    val haptics = rememberHaptics()
    val pick = { day: LocalDate -> haptics.tick(); onSelect(day) }
    val todayDate = Clock.System.now().toLocalDateTime(TimeZone.currentSystemDefault()).date
    Box(
        modifier
            .padding(vertical = 8.dp)
            .draggable(
                orientation = Orientation.Horizontal,
                state = rememberDraggableState { finger += it },
                onDragStopped = { velocity ->
                    val moved = finger
                    finger = 0f
                    when {
                        moved < -90f || velocity < -900f -> pick(selected.plus(DatePeriod(days = 7)))
                        moved > 90f || velocity > 900f -> pick(selected.plus(DatePeriod(days = -7)))
                    }
                },
            )
            .fillMaxWidth()
            .then(bounds.container())
            .clip(RoundedCornerShape(24.dp))
            .background(MaterialTheme.colorScheme.surface),
    ) {
        SlidingKnob(bounds, selected.dayOfWeek.isoDayNumber - 1, MaterialTheme.colorScheme.primary, CircleShape)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
        val dark = platformInDarkTheme()
        WeekArrow("Прошлая неделя", back = true) { pick(selected.plus(DatePeriod(days = -7))) }
        (0 until 7).forEach { offset ->
            val day = start.plus(DatePeriod(days = offset))
            val on = day == selected
            Column(
                Modifier.pressable { pick(day) }
                    .semantics { contentDescription = "${weekdayName(day)}, ${day.dayOfMonth} ${monthGenitive(day)}"; this.selected = on }
                    .clip(CircleShape).padding(horizontal = 3.dp, vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    weekdayShort(day),
                    fontSize = 12.sp,
                    color = if (offset >= 5) weekendColor(dark) else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Box(
                    Modifier.padding(top = 2.dp).then(bounds.item(offset)).size(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        day.dayOfMonth.toString(),
                        color = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.Medium,
                    )
                }
                // Точка под сегодняшним днём: видно «где я», даже когда выбран другой день.
                Box(
                    Modifier.padding(top = 1.dp).size(4.dp).clip(CircleShape)
                        .background(if (day == todayDate) Color(0xFFFF3B55) else Color.Transparent),
                )
            }
        }
        WeekArrow("Следующая неделя", back = false) { pick(selected.plus(DatePeriod(days = 7))) }
        }
    }
}

@Composable
private fun WeekArrow(label: String, back: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.pressable(role = Role.Button, onClickLabel = label, onClick = onClick).size(36.dp).clip(CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (back) ChevronLeftIcon(size = 16.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        else ChevronRightIcon(size = 16.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * Редактор события: без [initial] — создание, с ним — правка. [date] — день события, [today] нужен для быстрых «Завтра» и т.п.
 * [eventsFor] отдаёт известные события дня (или `null`): по ним подбирается свободное время и показывается пересечение.
 */
@Composable
fun EventEditor(
    initial: Event? = null,
    defaultStart: Int? = null,
    date: LocalDate,
    today: LocalDate,
    nowMinutes: Int,
    eventsFor: (LocalDate) -> List<Event>? = { null },
    submit: String = "Создать",
    onDirtyChange: (Boolean) -> Unit = {},
    onDelegate: ((String) -> Unit)? = null,
    onSave: (title: String, start: Int, end: Int, badge: String, allDay: Boolean, notes: String, extras: EventExtras, date: LocalDate) -> Unit,
) {
    var title by rememberSaveable { mutableStateOf(initial?.title.orEmpty()) }
    var dayIso by rememberSaveable { mutableStateOf(isoDate(date)) }
    val day = parseIsoDate(dayIso)
    fun busy(forDay: LocalDate) = eventsFor(forDay).orEmpty().filter { it.id != initial?.id }
    var startTouched by rememberSaveable { mutableStateOf(false) }
    var start by rememberSaveable {
        mutableStateOf(
            initial?.takeIf { !it.allDay }?.start ?: defaultStart
                ?: suggestStart(busy(date), nowMinutes.takeIf { date == today }),
        )
    }
    var length by rememberSaveable {
        mutableStateOf(initial?.takeIf { !it.allDay && it.end > it.start }?.let { it.end - it.start } ?: 60)
    }
    var badge by rememberSaveable { mutableStateOf(initial?.badge ?: "routine") }
    var allDay by rememberSaveable { mutableStateOf(initial?.allDay ?: false) }
    var notes by rememberSaveable { mutableStateOf(initial?.notes.orEmpty()) }
    var place by rememberSaveable { mutableStateOf(initial?.subtitle.orEmpty()) }
    var repeat by rememberSaveable { mutableStateOf(initial?.repeat.orEmpty()) }
    var url by rememberSaveable { mutableStateOf(initial?.url.orEmpty()) }
    var guests by rememberSaveable { mutableStateOf(initial?.attendees.orEmpty().joinToString(" ") { "@${it.username}" }) }
    // null — напоминание по умолчанию из настроек, -1 — не напоминать.
    var reminder by rememberSaveable { mutableStateOf<Int?>(initial?.reminders?.let { it.firstOrNull() ?: -1 }) }
    var reminderTouched by rememberSaveable { mutableStateOf(false) }
    // Другой день — другое «ближайшее свободное»: пока время не трогали руками, подбираем заново.
    LaunchedEffect(dayIso) {
        if (initial == null && defaultStart == null && !startTouched) {
            start = suggestStart(busy(day), nowMinutes.takeIf { day == today }, length)
        }
    }
    val dirty = if (initial == null) {
        title.isNotBlank() || place.isNotBlank() || notes.isNotBlank() || guests.isNotBlank() || url.isNotBlank()
    } else {
        title != initial.title || place != initial.subtitle || notes != initial.notes ||
            guests != initial.attendees.joinToString(" ") { "@${it.username}" } || url != initial.url ||
            dayIso != isoDate(date) || badge != initial.badge || allDay != initial.allDay ||
            repeat != initial.repeat || reminder != initial.reminders?.let { it.firstOrNull() ?: -1 } ||
            (!allDay && (start != initial.start || length != initial.end - initial.start))
    }
    LaunchedEffect(dirty) { onDirtyChange(dirty) }
    DisposableEffect(Unit) { onDispose { onDirtyChange(false) } }
    // Нестандартные время и длительность из события не теряются: добавляем их в список выбора.
    val startOptions = (starts + start).distinct().sorted()
    val lengthOptions = (listOf(30, 60, 90, 120, 180) + length).distinct().sorted()
    val canMove = initial == null || initial.repeat.isBlank()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SheetField(title, { title = it }, "Название события")
        SheetField(place, { place = it }, "Место — необязательно")
        SheetField(notes, { notes = it }, "Заметка — необязательно")
        if (canMove) DayChips(day, today) { dayIso = isoDate(it) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Весь день", modifier = Modifier.weight(1f))
            Switch(checked = allDay, onCheckedChange = { allDay = it })
        }
        if (!allDay) {
            Text("Начало", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            ChoiceRow {
                startOptions.forEach { value -> ChoicePill(formatMinutes(value), value == start, reveal = value == start) { start = value; startTouched = true } }
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
            badges.forEach { value ->
                ChoicePill(badgeLabel(value), value == badge, icon = { c -> BadgeIcon(value, size = 14.dp, color = c) }) { badge = value }
            }
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
        SheetField(url, { url = it }, "Ссылка — необязательно", last = true)
        if (initial == null && onDelegate != null) {
            // Не хочется выбирать чипы — отдать задачу ассистенту: текст запроса собираем из уже введённого.
            Row(
                Modifier.fillMaxWidth().pressable(role = Role.Button, haptic = true) {
                    val what = if (title.isBlank()) "Поставь событие" else "Поставь «${title.trim()}»"
                    val when_ = if (allDay) "${dayTitle(day).replaceFirstChar { it.lowercase() }}, на весь день"
                    else "${dayTitle(day).replaceFirstChar { it.lowercase() }}, ${formatMinutes(start)}–${formatMinutes((start + length).coerceAtMost(24 * 60))}"
                    onDelegate("$what — $when_" + if (place.isNotBlank()) ", место: ${place.trim()}" else "")
                }.defaultMinSize(minHeight = 44.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                InfinityIcon(size = 18.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(" Поручить ассистенту", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
            }
        }
    }
    SheetFooter {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val known = eventsFor(day)
            if (!allDay && known != null) {
                val end = (start + length).coerceAtMost(24 * 60)
                val clash = conflictWith(busy(day), start, end)
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
                        .background((if (clash == null) Color(0xFF4CC46D) else Color(0xFFF08B3D)).copy(alpha = 0.16f))
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(if (clash == null) Color(0xFF4CC46D) else Color(0xFFF08B3D)))
                    Text(
                        if (clash == null) {
                            "${formatMinutes(start)}–${formatMinutes(end)} — время свободно"
                        } else {
                            "Пересекается с «${clash.title.ifBlank { "Без названия" }}» (${formatMinutes(clash.start)}–${formatMinutes(clash.end)})"
                        },
                        fontSize = 13.sp,
                        maxLines = 2,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
            SheetButton(submit, title.isNotBlank()) {
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
                        subtitle = if (initial == null) place.ifBlank { null } else place.takeIf { it != initial.subtitle },
                        repeat = if (initial == null) repeat.ifBlank { null } else repeat.takeIf { it != initial.repeat },
                        attendees = if (initial == null) logins.takeIf { it.isNotEmpty() } else logins.takeIf { it != before },
                        url = if (initial == null) url.ifBlank { null } else url.takeIf { it != initial.url },
                        reminder = reminder,
                        reminderTouched = reminderTouched,
                    ),
                    day,
                )
            }
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
