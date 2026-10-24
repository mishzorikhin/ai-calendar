package app.calendar.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendar.CalendarController
import app.calendar.api.Task
import app.calendar.domain.habitCheckedNow
import app.calendar.domain.habitStreak
import app.calendar.domain.habitWeekDots
import app.calendar.domain.monthGenitive
import app.calendar.domain.parseIsoDate
import app.calendar.domain.pluralize
import app.calendar.domain.streakUnit
import app.calendar.domain.weekdayChartShort
import kotlinx.datetime.LocalDate

/** Цели, привычки и задачи: три вида карточек, как `TasksGrid`, `HabitCards` и `PrepCard` на сайте. */
@Composable
fun TasksSection(controller: CalendarController, today: LocalDate) {
    val goals = controller.tasks.filter { it.kind == "goal" }
    val habits = controller.tasks.filter { it.kind == "habit" }
    val items = controller.tasks.filter { it.kind == "task" }
    var index = 4
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        goals.forEach { goal -> GoalCard(controller, goal, Modifier.appear(index++)) }
        if (habits.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).appear(index++),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                habits.forEach { habit -> HabitCard(controller, habit, today) }
            }
        }
        items.filter { !it.done }.forEach { task -> TaskCard(controller, task, Modifier.appear(index++)) }
        val done = items.filter { it.done }
        if (done.isNotEmpty()) {
            Row(
                Modifier.pressable(role = Role.Button) { controller.showDoneTasks = !controller.showDoneTasks }
                    .defaultMinSize(minHeight = 44.dp)
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("Выполненные · ${done.size}", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
                val turn by animateFloatAsState(if (controller.showDoneTasks) 180f else 0f, uiSpring(), label = "done")
                ChevronDownIcon(Modifier.graphicsLayer { rotationZ = turn }, size = 14.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (controller.showDoneTasks) done.forEach { task -> TaskCard(controller, task) }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun CheckButton(done: Boolean, label: String, size: androidx.compose.ui.unit.Dp = 44.dp, onClick: () -> Unit) {
    val pop by animateFloatAsState(if (done) 1f else 0f, bouncySpring(), label = "check")
    val fill by animateColorAsState(
        if (done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
        uiSpring(),
        label = "fill",
    )
    val haptics = rememberHaptics()
    Box(
        Modifier.pressable(role = Role.Checkbox, onClickLabel = label) {
                haptics.toggle(!done)
                onClick()
            }
            .semantics { stateDescription = if (done) "Выполнено" else "Не выполнено" }
            .size(size)
            .clip(CircleShape)
            .background(fill)
            .then(if (done) Modifier else Modifier.border(BorderStroke(1.5.dp, MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f)), CircleShape)),
        contentAlignment = Alignment.Center,
    ) {
        CheckIcon(
            Modifier.graphicsLayer {
                alpha = pop.coerceIn(0f, 1f)
                scaleX = pop
                scaleY = pop
            },
            size = 18.dp,
            color = MaterialTheme.colorScheme.onPrimary,
        )
    }
}

@Composable
private fun GoalCard(controller: CalendarController, goal: Task, modifier: Modifier) {
    val caption = buildList {
        add(goal.subtitle.ifBlank { "Цель" })
        if (goal.due.isNotBlank()) runCatching { parseIsoDate(goal.due) }.getOrNull()?.let { add("к ${it.dayOfMonth} ${monthGenitive(it)}") }
    }.joinToString(" · ")
    Row(
        modifier.fillMaxWidth()
            .clip(RoundedCornerShape(28.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(start = 18.dp, end = 12.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            Modifier.weight(1f).pressable(role = Role.Button, onClickLabel = "Изменить") { controller.openedTask = goal }.padding(vertical = 6.dp),
        ) {
            Text(
                goal.title,
                fontSize = 20.sp,
                fontWeight = FontWeight.SemiBold,
                textDecoration = if (goal.done) TextDecoration.LineThrough else null,
                color = if (goal.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            Text(caption, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        CheckButton(goal.done, if (goal.done) "Снять отметку" else "Отметить выполненной") { controller.toggleTask(goal) }
    }
}

@Composable
private fun HabitCard(controller: CalendarController, habit: Task, today: LocalDate) {
    val cadence = habit.cadence.ifBlank { "daily" }
    val streak = habitStreak(cadence, habit.checks, today)
    val done = habitCheckedNow(cadence, habit.checks, today)
    val (one, few, many) = streakUnit(cadence)
    Column(
        Modifier.width(264.dp)
            .clip(RoundedCornerShape(28.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).pressable(role = Role.Button, onClickLabel = "Изменить") { controller.openedTask = habit }) {
                val streakInk = if (streak > 0) badgeColor("food") else MaterialTheme.colorScheme.onSurfaceVariant
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    FlameIcon(size = 16.dp, color = streakInk)
                    Text(
                        "$streak ${pluralize(streak, one, few, many).substringAfter(' ')} подряд",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(habit.title, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp), maxLines = 2)
            }
            CheckButton(done, if (done) "Снять отметку: ${habit.title}" else "Сделано: ${habit.title}") { controller.toggleTask(habit) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            habitWeekDots(habit.checks, today).forEach { (date, on) ->
                Box(
                    Modifier.size(28.dp)
                        .clip(CircleShape)
                        .background(if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
                        .then(if (date == today) Modifier.border(BorderStroke(1.5.dp, MaterialTheme.colorScheme.onSurface), CircleShape) else Modifier),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        weekdayChartShort(date),
                        fontSize = 11.sp,
                        color = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun TaskCard(controller: CalendarController, task: Task, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(start = 10.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CheckButton(task.done, if (task.done) "Снять отметку" else "Отметить выполненной", size = 44.dp) { controller.toggleTask(task) }
        Column(
            Modifier.weight(1f).pressable(role = Role.Button, onClickLabel = "Изменить") { controller.openedTask = task }
                .padding(start = 8.dp, top = 6.dp, bottom = 6.dp),
        ) {
            Text(
                task.title,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                textDecoration = if (task.done) TextDecoration.LineThrough else null,
                color = if (task.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            if (task.subtitle.isNotBlank()) {
                Text(task.subtitle, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
        if (task.category.isNotBlank()) {
            Row(
                Modifier.clip(RoundedCornerShape(999.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 10.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                TagIcon(task.category, MaterialTheme.colorScheme.onSurface, 14.dp)
                Text(tagLabel(task.category), fontSize = 13.sp, maxLines = 1)
            }
        }
    }
}
