package app.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendar.CalendarController
import app.calendar.Screen
import app.calendar.domain.avatarColor
import app.calendar.domain.dayTitle
import app.calendar.domain.formatRange
import app.calendar.domain.monthShort
import app.calendar.domain.pluralize

@Composable
fun HomeScreen(controller: CalendarController) {
    val today = controller.today()
    val user = controller.user
    val count = controller.todayEvents.size
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(
                Modifier.weight(1f).clickable { controller.open(Screen.Day(today)) }.padding(vertical = 4.dp),
            ) {
                Text(
                    dayTitle(today),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.3).sp,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Открыть день", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                    ArrowRightIcon(size = 13.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            CircleButton { SearchIcon(size = 19.dp, color = MaterialTheme.colorScheme.onSurface) }
            if (user != null) {
                val initial = (user.name.ifBlank { user.username }).trim().take(1).uppercase()
                Box(
                    Modifier
                        .padding(start = 10.dp)
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(Color(avatarColor(user.username)))
                        .clickable { controller.logout() },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(initial, color = Color(0xFF1E1E3C), fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                }
            }
            DateChip(day = today.dayOfMonth, month = monthShort(today)) { controller.open(Screen.Month) }
        }
        Surface(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            shape = RoundedCornerShape(32.dp),
            color = MaterialTheme.colorScheme.surface,
            shadowElevation = 1.dp,
        ) {
            CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
            Column(Modifier.padding(start = 22.dp, end = 22.dp, top = 24.dp, bottom = 22.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text("Сегодня", fontSize = 48.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-1.2).sp, lineHeight = 50.sp, color = MaterialTheme.colorScheme.onSurface)
                        Text(
                            pluralize(count, "событие", "события", "событий") + " в календаре",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 14.sp,
                        )
                    }
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.clickable { controller.showWeek() },
                    ) {
                        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            ChartIcon(size = 15.dp, color = MaterialTheme.colorScheme.onSurface)
                            Text(" Неделя", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }
                val next = controller.todayEvents.filter { !it.allDay }.minByOrNull { it.start }
                Column(Modifier.padding(top = 30.dp).clickable {
                    if (next == null) controller.compose(today) else controller.open(Screen.Day(today))
                }) {
                    if (next == null) {
                        Text("Свободный день", fontSize = 32.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.6).sp, color = MaterialTheme.colorScheme.onSurface)
                        Text(
                            "Нажмите, чтобы что-нибудь запланировать",
                            modifier = Modifier.padding(top = 6.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 15.sp,
                        )
                    } else {
                        Text(
                            "Далее · ${formatRange(next.start, next.end, next.allDay)}",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 14.sp,
                        )
                        Text(
                            next.title,
                            modifier = Modifier.padding(top = 6.dp),
                            fontSize = 32.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.6).sp,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        if (next.subtitle.isNotBlank()) {
                            Text(next.subtitle, modifier = Modifier.padding(top = 6.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 15.sp)
                        }
                        Row(Modifier.padding(top = 18.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            GhostPill("Изменить") { controller.compose(today) }
                            GhostPill("Весь день") { controller.open(Screen.Day(today)) }
                        }
                    }
                }
            }
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 22.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Задачи и цели", modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            Box(
                Modifier.size(44.dp).clip(CircleShape).clickable { controller.taskSheet = true },
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(28.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surface), contentAlignment = Alignment.Center) {
                    PlusIcon(size = 15.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (controller.tasks.isEmpty()) {
            Column(Modifier.padding(top = 18.dp, start = 6.dp).clickable { controller.taskSheet = true }) {
                Text(
                    "Задач пока нет",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 32.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.6).sp,
                )
                Text(
                    "Нажмите, чтобы добавить — или попросите ассистента",
                    modifier = Modifier.padding(top = 6.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 15.sp,
                )
            }
        } else {
            Spacer(Modifier.height(8.dp))
            controller.tasks.filter { it.kind != "habit" || true }.forEach { task ->
                Text(
                    task.title,
                    modifier = Modifier.clickable { controller.toggleTask(task) }.padding(vertical = 8.dp, horizontal = 6.dp),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (task.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@Composable
private fun CircleButton(onClick: () -> Unit = {}, content: @Composable () -> Unit) {
    Box(
        Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun GhostPill(label: String, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        fontSize = 14.sp,
        color = MaterialTheme.colorScheme.onSurface,
    )
}

@Composable
private fun DateChip(day: Int, month: String, onClick: () -> Unit) {
    Box(Modifier.padding(start = 10.dp).clickable(onClick = onClick)) {
        Column(
            Modifier
                .size(width = 60.dp, height = 62.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(MaterialTheme.colorScheme.surface),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                day.toString().padStart(2, '0'),
                fontSize = 23.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.8).sp,
                lineHeight = 23.sp,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(month, fontSize = 11.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .offset(x = 4.dp, y = (-4).dp)
                .size(22.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary),
            contentAlignment = Alignment.Center,
        ) {
            CalendarIcon(size = 12.dp, color = MaterialTheme.colorScheme.onPrimary)
        }
    }
}
