package app.calendar.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendar.CalendarController
import app.calendar.api.WeekDayInsight
import app.calendar.api.WeekInsights
import app.calendar.domain.badgeOptions
import app.calendar.domain.hoursText
import app.calendar.domain.isoDate
import app.calendar.domain.parseIsoDate
import app.calendar.domain.pluralWord
import app.calendar.domain.weekRangeLabel
import app.calendar.domain.weekdayChartShort
import kotlin.math.abs

@Composable
fun WeekSheet(controller: CalendarController, onClose: () -> Unit) {
    val today = isoDate(controller.today())
    val start = controller.weekStart
    val insights = controller.weekInsights
    val dark = platformInDarkTheme()
    LaunchedEffect(start, controller.weekSheet) {
        if (controller.weekSheet) controller.refreshWeek()
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f)) {
            Text(
                "Неделя",
                fontSize = 24.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.35).sp,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                weekRangeLabel(start),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 13.sp,
                lineHeight = 18.sp,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            GrayCircleButton(onClick = { controller.shiftWeek(-1) }) {
                ChevronLeftIcon(size = 18.dp, color = MaterialTheme.colorScheme.onSurface)
            }
            GrayCircleButton(onClick = { controller.shiftWeek(1) }) {
                ChevronRightIcon(size = 18.dp, color = MaterialTheme.colorScheme.onSurface)
            }
            GrayCircleButton(onClick = onClose) {
                CloseIcon(size = 18.dp, color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
    if (controller.weekError) {
        Text(
            "Не удалось посчитать неделю",
            modifier = Modifier.padding(top = 16.dp, start = 4.dp),
            color = MaterialTheme.colorScheme.error,
            fontSize = 13.sp,
        )
    }
    insights?.let { r -> WeekInsightsBody(r, today, dark, onDay = controller::openDayFromWeek) }
}

@Composable
private fun GrayCircleButton(onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}

@Composable
private fun WeekInsightsBody(r: WeekInsights, today: String, dark: Boolean, onDay: (String) -> Unit) {
    val max = maxOf(60, r.days.maxOfOrNull { it.minutes } ?: 0)
    val types = badgeOptions
        .mapNotNull { opt ->
            val minutes = r.byBadge[opt.id] ?: 0
            if (minutes > 0) opt.label to minutes else null
        }
        .sortedByDescending { it.second }
    val topType = types.firstOrNull()?.second?.coerceAtLeast(1) ?: 1
    val barMuted = inkSoft(dark)
    val line = lineColor(dark)

    Text(
        text = buildAnnotatedString {
            withStyle(SpanStyle(fontSize = 34.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.4).sp, color = MaterialTheme.colorScheme.onSurface)) {
                append(hoursText(r.minutes))
            }
            withStyle(SpanStyle(fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)) {
                append(" встреч")
            }
        },
        modifier = Modifier.padding(top = 22.dp, start = 4.dp),
        lineHeight = 38.sp,
    )
    Text(
        compareWeekText(r),
        modifier = Modifier.padding(top = 2.dp, start = 4.dp),
        fontSize = 14.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 18.dp)
            .height(180.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        r.days.forEach { day ->
            WeekDayColumn(
                day,
                today,
                busiest = day.date == r.busiest,
                max = max,
                barMuted = barMuted,
                line = line,
                onDay = onDay,
                modifier = Modifier.weight(1f),
            )
        }
    }

    Row(Modifier.fillMaxWidth().padding(top = 18.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        WeekTile(hoursText(r.focus), "для фокуса — окна от 1,5 ч в рабочее время", Modifier.weight(1f))
        WeekTile(
            r.done.toString(),
            "${pluralWord(r.done, "задача закрыта", "задачи закрыто", "задач закрыто")} за неделю",
            Modifier.weight(1f),
        )
    }

    if (types.isNotEmpty()) {
        Text(
            "По типам",
            modifier = Modifier.padding(top = 20.dp, start = 4.dp, bottom = 8.dp),
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            types.forEach { (label, minutes) ->
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(label, modifier = Modifier.width(72.dp), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface)
                    Box(
                        Modifier
                            .weight(1f)
                            .height(10.dp)
                            .clip(RoundedCornerShape(5.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant),
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth(minutes.toFloat() / topType)
                                .fillMaxHeight()
                                .clip(RoundedCornerShape(5.dp))
                                .background(MaterialTheme.colorScheme.onSurface),
                        )
                    }
                    Text(
                        hoursText(minutes),
                        modifier = Modifier.width(84.dp),
                        textAlign = TextAlign.End,
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun WeekDayColumn(
    day: WeekDayInsight,
    today: String,
    busiest: Boolean,
    max: Int,
    barMuted: androidx.compose.ui.graphics.Color,
    line: androidx.compose.ui.graphics.Color,
    onDay: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val date = parseIsoDate(day.date)
    val targetFraction = if (day.minutes > 0 && max > 0) day.minutes.toFloat() / max else 0f
    val fraction by animateFloatAsState(
        targetValue = targetFraction,
        animationSpec = spring(dampingRatio = 0.98f, stiffness = 420f),
        label = "weekBar",
    )
    Column(
        modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(12.dp))
            .clickable { onDay(day.date) },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            if (busiest) hoursText(day.minutes) else "",
            modifier = Modifier.height(16.dp),
            fontSize = 11.sp,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .align(Alignment.BottomCenter)
                    .background(line),
            )
            if (fraction > 0f) {
                Box(
                    Modifier
                        .width(30.dp)
                        .fillMaxHeight(fraction.coerceIn(0f, 1f))
                        .clip(RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp))
                        .background(if (busiest) MaterialTheme.colorScheme.onSurface else barMuted),
                )
            }
        }
        val todayMark = day.date == today
        Box(
            Modifier
                .height(24.dp)
                .clip(RoundedCornerShape(8.dp))
                .then(if (todayMark) Modifier.background(MaterialTheme.colorScheme.surfaceVariant) else Modifier)
                .padding(horizontal = 6.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                weekdayChartShort(date),
                fontSize = 12.sp,
                fontWeight = if (todayMark) FontWeight.SemiBold else FontWeight.Normal,
                color = if (todayMark) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun compareWeekText(r: WeekInsights): String {
    if (r.average == 0) {
        return if (r.minutes > 0) "раньше встреч не было — не с чем сравнить" else "неделя свободна"
    }
    val diff = r.minutes - r.average
    if (abs(diff) < 60) return "примерно как обычно"
    return if (diff > 0) "на ${hoursText(diff)} больше обычного" else "на ${hoursText(-diff)} меньше обычного"
}

@Composable
private fun WeekTile(title: String, subtitle: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(title, fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.3).sp, color = MaterialTheme.colorScheme.onSurface)
        Text(subtitle, fontSize = 12.5.sp, lineHeight = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
