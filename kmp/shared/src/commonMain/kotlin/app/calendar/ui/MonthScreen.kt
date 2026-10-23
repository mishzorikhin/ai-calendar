package app.calendar.ui

import androidx.compose.ui.semantics.Role
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendar.CalendarController
import app.calendar.Screen
import app.calendar.domain.formatMinutes
import app.calendar.domain.monthCells
import app.calendar.domain.monthGenitive
import app.calendar.domain.monthName
import app.calendar.domain.monthTitle
import app.calendar.domain.pluralize
import app.calendar.domain.weekdayShort
import kotlin.math.abs
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.plus

@Composable
fun MonthScreen(controller: CalendarController) {
    val cursor = controller.monthCursor
    val today = controller.today()
    var pickedDay by rememberSaveable { mutableStateOf(today.dayOfMonth) }
    // 31-е при переходе на февраль — последний день месяца, а не «сегодня» из другого месяца.
    val lastDay = cursor.plus(DatePeriod(months = 1)).plus(DatePeriod(days = -1)).dayOfMonth
    val picked = LocalDate(cursor.year, cursor.monthNumber, pickedDay.coerceIn(1, lastDay))
    LaunchedEffect(picked) { controller.load(Screen.Day(picked)) }
    val density = LocalDensity.current
    val touchSlop = LocalViewConfiguration.current.touchSlop
    // Направление нужно до смены месяца: и сетка, и подпись едут в одну сторону.
    var dir by remember { mutableIntStateOf(1) }
    var finger by remember { mutableFloatStateOf(0f) }
    var suppressClick by remember { mutableStateOf(false) }
    var pickerOpen by remember { mutableStateOf(false) }
    val chevron by animateFloatAsState(if (pickerOpen) 180f else 0f, spring(dampingRatio = 0.98f, stiffness = 420f))
    var dotCache by remember { mutableStateOf(mapOf<String, Map<Int, List<String>>>()) }
    // Кладём точки под ключ, которому они принадлежат: ответ мог прийти уже после смены месяца.
    LaunchedEffect(controller.monthDots, controller.monthDotsKey) {
        controller.monthDotsKey?.let { key -> dotCache = dotCache + (key to controller.monthDots) }
    }
    val motion = spring<IntOffset>(dampingRatio = 0.98f, stiffness = 420f)
    val fade = spring<Float>(dampingRatio = 0.98f, stiffness = 420f)
    fun go(delta: Int) {
        if (delta == 0) return
        dir = delta
        finger = 0f
        suppressClick = false
        controller.shiftMonth(delta)
    }
    fun shiftYear(delta: Int) {
        val year = cursor.year + delta
        if (year !in 1970..2100) return
        dir = delta
        finger = 0f
        controller.showMonth(year, cursor.monthNumber)
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AnimatedContent(
                targetState = cursor.year,
                modifier = Modifier.clipToBounds(),
                transitionSpec = {
                    val px = with(density) { 14.dp.roundToPx() }
                    (slideInVertically(motion) { dir * px } + fadeIn(fade)) togetherWith
                        (slideOutVertically(motion) { -dir * px } + fadeOut(fade))
                },
                label = "year",
            ) { year ->
                Text(year.toString(), fontSize = 44.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-1).sp)
            }
            Box(
                Modifier
                    .padding(start = 4.dp)
                    .size(44.dp)
                    .clip(CircleShape)
                    .clickable(role = Role.Button, onClickLabel = if (pickerOpen) "Скрыть выбор года" else "Выбрать год и месяц") { pickerOpen = !pickerOpen },
                contentAlignment = Alignment.Center,
            ) {
                ChevronDownIcon(
                    modifier = Modifier.graphicsLayer { rotationZ = chevron },
                    size = 16.dp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Box(Modifier.weight(1f))
            Circle("Закрыть месяц", onClick = { controller.open(Screen.Home) }) { CloseIcon(size = 18.dp) }
        }
        AnimatedVisibility(pickerOpen, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            Row(
                Modifier.padding(top = 8.dp).fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Circle("Предыдущий год", onClick = { shiftYear(-1) }) { ChevronLeftIcon(size = 16.dp) }
                Row(
                    Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    repeat(12) { index ->
                        val month = index + 1
                        ChoicePill(monthName(month), month == cursor.monthNumber) {
                            val delta = month - cursor.monthNumber
                            if (delta != 0) {
                                dir = if (delta > 0) 1 else -1
                                finger = 0f
                                controller.showMonth(cursor.year, month)
                            }
                            pickerOpen = false
                        }
                    }
                }
                Circle("Следующий год", onClick = { shiftYear(1) }) { ChevronRightIcon(size = 16.dp) }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            AnimatedContent(
                targetState = cursor,
                modifier = Modifier.weight(1f),
                transitionSpec = {
                    val px = with(density) { 30.dp.roundToPx() }
                    (slideInHorizontally(motion) { dir * px } + fadeIn(fade)) togetherWith
                        (slideOutHorizontally(motion) { -dir * px } + fadeOut(fade))
                },
                label = "monthTitle",
            ) { page ->
                Text(
                    monthTitle(page).substringBefore(' '),
                    fontSize = 44.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    letterSpacing = (-1).sp,
                )
            }
            Circle("Предыдущий месяц", onClick = { go(-1) }) { ChevronLeftIcon(size = 18.dp) }
            Box(Modifier.size(8.dp))
            Circle("Следующий месяц", onClick = { go(1) }) { ChevronRightIcon(size = 18.dp) }
        }
        Column(
            Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(28.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(12.dp),
        ) {
            Row(Modifier.fillMaxWidth()) {
                val monday = LocalDate(2026, 1, 5)
                repeat(7) { index ->
                    val label = weekdayShort(monday.plus(DatePeriod(days = index)))
                    Text(
                        label,
                        modifier = Modifier.weight(1f),
                        textAlign = TextAlign.Center,
                        color = if (index >= 5) weekendColor(platformInDarkTheme()) else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 13.sp,
                    )
                }
            }
            val dragState = rememberDraggableState { delta ->
                finger += delta
                if (abs(finger) > touchSlop) suppressClick = true
            }
            Box(
                Modifier
                    .padding(top = 4.dp)
                    .fillMaxWidth()
                    .clipToBounds()
                    .draggable(
                        orientation = Orientation.Horizontal,
                        state = dragState,
                        onDragStopped = { velocity ->
                            val threshold = with(density) { 60.dp.toPx() }
                            when {
                                finger < -threshold || velocity < -400f -> go(1)
                                finger > threshold || velocity > 400f -> go(-1)
                                else -> {
                                    val start = finger
                                    Animatable(start).animateTo(0f, spring(dampingRatio = 0.98f, stiffness = 420f)) {
                                        finger = value
                                    }
                                    suppressClick = false
                                }
                            }
                        },
                    ),
            ) {
                AnimatedContent(
                    targetState = cursor,
                    modifier = Modifier.fillMaxWidth(),
                    transitionSpec = {
                        val px = with(density) { 80.dp.roundToPx() }
                        (slideInHorizontally(motion) { dir * px } + fadeIn(fade)) togetherWith
                            (slideOutHorizontally(motion) { -dir * px } + fadeOut(fade))
                    },
                    label = "monthGrid",
                ) { page ->
                    val key = "${page.year}-${page.monthNumber}"
                    MonthDays(
                        page = page,
                        today = today,
                        picked = picked,
                        dots = dotCache[key].orEmpty(),
                        onPick = { day -> if (!suppressClick) pickedDay = day },
                        modifier = Modifier.graphicsLayer {
                            translationX = if (page == cursor) finger * 0.18f else 0f
                        },
                    )
                }
            }
        }
        val headline = controller.dayEvents.minByOrNull { it.start }
        Column(
            Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(28.dp))
                .background(MaterialTheme.colorScheme.surface)
                .clickable(role = Role.Button) { controller.open(Screen.Day(picked)) }
                .padding(18.dp),
        ) {
            Text(picked.dayOfMonth.toString(), fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "Сегодня · ${monthGenitive(picked)}".takeIf { picked == today } ?: monthGenitive(picked),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 13.sp,
            )
            Text(headline?.title ?: "Свободный день", modifier = Modifier.padding(top = 8.dp), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            Text(
                if (headline == null) "Нет событий" else "в ${formatMinutes(headline.start)} · ${pluralize(controller.dayEvents.size, "событие", "события", "событий")}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 14.sp,
            )
        }
    }
}

@Composable
private fun MonthDays(
    page: LocalDate,
    today: LocalDate,
    picked: LocalDate,
    dots: Map<Int, List<String>>,
    onPick: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth()) {
        monthCells(page.year, page.monthNumber).chunked(7).forEach { week ->
            Row(Modifier.fillMaxWidth()) {
                repeat(7) { index ->
                    val day = week.getOrNull(index)
                    val selected = day != null && day == picked.dayOfMonth && picked.monthNumber == page.monthNumber && picked.year == page.year
                    val isToday = day != null && today.year == page.year && today.monthNumber == page.monthNumber && today.dayOfMonth == day
                    Box(
                        Modifier.weight(1f).height(52.dp).clickable(enabled = day != null, role = Role.Button) { if (day != null) onPick(day) },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (day != null) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Box(
                                    Modifier.size(32.dp).clip(CircleShape).background(
                                        when {
                                            isToday -> MaterialTheme.colorScheme.primary
                                            selected -> MaterialTheme.colorScheme.surfaceVariant
                                            else -> Color.Transparent
                                        },
                                    ),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        day.toString(),
                                        color = when {
                                            isToday -> MaterialTheme.colorScheme.onPrimary
                                            index >= 5 -> weekendColor(platformInDarkTheme())
                                            else -> MaterialTheme.colorScheme.onSurface
                                        },
                                    )
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                    dots[day].orEmpty().distinct().take(3).forEach { badge ->
                                        Box(Modifier.size(5.dp).clip(CircleShape).background(badgeColor(badge)))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Circle(label: String, onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        Modifier
            .padding(start = 8.dp)
            .size(44.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surface)
            .clickable(role = Role.Button, onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { content() }
}
