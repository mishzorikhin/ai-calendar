package app.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendar.CalendarController
import app.calendar.OpenedEvent
import app.calendar.Screen
import app.calendar.api.Event
import app.calendar.api.Memory
import app.calendar.api.Task
import app.calendar.domain.avatarColor
import app.calendar.domain.badgeLabel
import app.calendar.domain.formatMinutes
import app.calendar.domain.formatRange
import app.calendar.domain.isoDate
import app.calendar.domain.monthGenitive
import app.calendar.domain.parseIsoDate
import app.calendar.domain.pluralize

/** Кнопка шторки: залитая — главное действие, остальные — тихие. */
@Composable
fun ActionPill(label: String, modifier: Modifier = Modifier, filled: Boolean = false, danger: Boolean = false, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Box(
        modifier
            .defaultMinSize(minHeight = 48.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(if (filled) colors.primary else colors.surfaceVariant)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            color = when {
                filled -> colors.onPrimary
                danger -> colors.error
                else -> colors.onSurface
            },
        )
    }
}

@Composable
private fun Caption(text: String) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
}

@Composable
private fun SheetTitle(text: String, onClose: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text,
            modifier = Modifier.weight(1f),
            fontSize = 24.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Box(
            Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Закрыть", onClick = onClose),
            contentAlignment = Alignment.Center,
        ) { CloseIcon(size = 18.dp, color = MaterialTheme.colorScheme.onSurface) }
    }
}

private fun dateLabel(iso: String): String {
    val date = runCatching { parseIsoDate(iso) }.getOrNull() ?: return iso
    return "${date.dayOfMonth} ${monthGenitive(date)}"
}

private val repeatLabels = mapOf(
    "daily" to "каждый день",
    "weekdays" to "по будням",
    "weekly" to "каждую неделю",
    "monthly" to "каждый месяц",
    "yearly" to "каждый год",
)

/** Событие: просмотр, правка, удаление; для приглашения — ответ «Приду / Не приду». */
@Composable
fun EventSheet(controller: CalendarController, opened: OpenedEvent) {
    val event = opened.event
    val editable = !event.readOnly && event.invite == null
    var editing by rememberSaveable(event.id) { mutableStateOf(false) }
    var confirmDelete by rememberSaveable(event.id) { mutableStateOf(false) }
    val close = { controller.openedEvent = null }

    if (editing && editable) {
        SheetTitle("Изменить событие", onClose = { editing = false })
        EventEditor(initial = event, submit = "Сохранить") { title, start, end, badge, allDay, notes, extras ->
            if (!controller.loading) {
                controller.updateEvent(opened, title, start, end, badge, allDay, notes, extras) { close() }
            }
        }
        return
    }

    SheetTitle(event.title.ifBlank { "Без названия" }, onClose = close)
    Caption("${dateLabel(isoDate(opened.date))} · ${formatRange(event.start, event.end, event.allDay)}")
    if (event.subtitle.isNotBlank()) Text(event.subtitle, color = MaterialTheme.colorScheme.onSurface)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(badgeColor(event.badge)))
        Text(
            " ${badgeLabel(event.badge)}" + (repeatLabels[event.repeat]?.let { " · $it" } ?: ""),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 14.sp,
        )
    }
    if (event.notes.isNotBlank()) Text(event.notes, color = MaterialTheme.colorScheme.onSurface)
    if (event.url.isNotBlank()) Caption(event.url)
    if (event.attendees.isNotEmpty()) {
        Caption("Участники")
        event.attendees.forEach { person ->
            val status = when (person.status) {
                "accepted" -> "придёт"
                "declined" -> "не придёт"
                else -> "ждёт ответа"
            }
            Text("${person.name.ifBlank { person.username }} — $status", fontSize = 14.sp)
        }
    }

    val invite = event.invite
    if (invite != null) {
        Caption("Позвал(а): ${invite.from.name.ifBlank { invite.from.username }}")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionPill("Приду", filled = invite.status != "accepted") { controller.answerInvite(opened, "accepted") }
            ActionPill("Не приду", danger = true) { controller.answerInvite(opened, "declined") }
        }
    } else if (event.readOnly) {
        Caption("Событие из внешнего календаря — только просмотр")
    } else if (confirmDelete) {
        Caption(if (event.repeat.isBlank()) "Удалить событие?" else "Удалить всю серию или только этот день?")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionPill("Удалить", danger = true) {
                controller.deleteEvent(event, opened.date)
                close()
            }
            if (event.repeat.isNotBlank()) ActionPill("Только этот день") { controller.skipOccurrence(opened) }
            ActionPill("Оставить") { confirmDelete = false }
        }
    } else {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionPill("Изменить", filled = true) { editing = true }
            ActionPill("Удалить", danger = true) { confirmDelete = true }
        }
    }
}

/** Задача или цель: правка названия, заметки и срока, участники, удаление. */
@Composable
fun TaskSheet(controller: CalendarController, task: Task) {
    var title by rememberSaveable(task.id) { mutableStateOf(task.title) }
    var note by rememberSaveable(task.id) { mutableStateOf(task.subtitle) }
    var due by rememberSaveable(task.id) { mutableStateOf(task.due) }
    var confirmDelete by rememberSaveable(task.id) { mutableStateOf(false) }
    val dueValid = due.isBlank() || Regex("""\d{4}-\d{2}-\d{2}""").matches(due.trim())
    val canSave = title.isNotBlank() && dueValid && !controller.loading
    SheetTitle(
        when (task.kind) {
            "goal" -> "Цель"
            "habit" -> "Привычка"
            else -> "Задача"
        },
        onClose = { controller.openedTask = null },
    )
    SheetField(title, { title = it }, "Название")
    SheetField(note, { note = it }, "Заметка — необязательно")
    if (task.kind != "habit") {
        SheetField(due, { due = it }, "Срок, ГГГГ-ММ-ДД — необязательно")
        if (!dueValid) Text("Дата в виде 2026-12-31", color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
    }
    var guest by rememberSaveable(task.id) { mutableStateOf("") }
    Caption("Вместе")
    task.owner?.let { Text("${it.name.ifBlank { it.username }} · владелец", fontSize = 14.sp) }
    task.members.forEach { member ->
        Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 44.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(member.name.ifBlank { member.username }, modifier = Modifier.weight(1f), fontSize = 14.sp)
            if (task.role != "member") {
                Text(
                    "Убрать",
                    modifier = Modifier.clickable(role = Role.Button) { controller.removeMember(task, member.username) }.padding(12.dp),
                    color = MaterialTheme.colorScheme.error,
                    fontSize = 14.sp,
                )
            }
        }
    }
    if (task.role != "member") {
        SheetField(guest, { guest = it }, "Добавить: @логин")
        if (guest.isNotBlank()) {
            ActionPill("Добавить участника") {
                controller.addMember(task, guest)
                guest = ""
            }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ActionPill("Сохранить", filled = canSave) { if (canSave) controller.updateTask(task, title, note, due) }
        if (confirmDelete) {
            ActionPill(if (task.role == "member") "Выйти" else "Удалить", danger = true) { controller.deleteTask(task) }
            ActionPill("Оставить") { confirmDelete = false }
        } else {
            ActionPill(if (task.role == "member") "Выйти из задачи" else "Удалить", danger = true) { confirmDelete = true }
        }
    }
}

/** Поиск по событиям и задачам. */
@Composable
fun SearchSheet(controller: CalendarController) {
    var query by rememberSaveable { mutableStateOf("") }
    val result = controller.searchResult
    SheetTitle("Поиск", onClose = controller::closeSearch)
    SheetField(query, { query = it; controller.search(it) }, "Событие или задача")
    when {
        query.isBlank() -> Caption("Начните вводить — найдём среди событий и задач")
        result == null -> Caption("Ищем…")
        result.events.isEmpty() && result.tasks.isEmpty() -> Caption("Ничего не нашлось")
        else -> {
            result.events.take(20).forEach { event ->
                ResultRow(
                    title = event.title.ifBlank { "Без названия" },
                    subtitle = "${dateLabel(event.date)} · ${formatRange(event.start, event.end, event.allDay)}",
                ) {
                    controller.closeSearch()
                    controller.open(Screen.Day(parseIsoDate(event.date)))
                }
            }
            result.tasks.take(20).forEach { task ->
                ResultRow(title = task.title, subtitle = if (task.done) "задача · готово" else "задача") {
                    controller.closeSearch()
                    controller.openedTask = task
                }
            }
        }
    }
}

@Composable
private fun ResultRow(title: String, subtitle: String, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Text(title, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
        Text(subtitle, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun MenuRow(title: String, sub: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = MaterialTheme.colorScheme.onSurface)
            if (sub.isNotBlank()) Text(sub, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        ChevronRightIcon(size = 16.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private val weekdayNames = listOf("вс", "пн", "вт", "ср", "чт", "пт", "сб")

/** «пн–пт» для подряд идущих рабочих дней, иначе перечисление. */
private fun workDaysLabel(days: List<Int>): String {
    val ordered = days.sortedBy { if (it == 0) 7 else it }
    if (ordered.isEmpty()) return "без рабочих дней"
    val seq = ordered.map { if (it == 0) 7 else it }
    val consecutive = seq.zipWithNext().all { (x, y) -> y == x + 1 }
    return if (consecutive && ordered.size > 2) "${weekdayNames[ordered.first()]}–${weekdayNames[ordered.last()]}"
    else ordered.joinToString(", ") { weekdayNames[it] }
}

/** Аккаунт: профиль, пункты настроек, оформление, уведомления, выход. */
@Composable
fun AccountSheet(controller: CalendarController) {
    val user = controller.user ?: return
    var name by rememberSaveable(user.id) { mutableStateOf(user.name) }
    var renaming by rememberSaveable { mutableStateOf(false) }
    var confirmLogout by rememberSaveable { mutableStateOf(false) }
    val unread = controller.notifications.count { !it.read }
    val profile = controller.profile
    val facts = controller.memories.size

    SheetTitle("Аккаунт", onClose = { controller.accountSheet = false })
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(56.dp).clip(CircleShape).background(Color(avatarColor(user.username))),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                user.name.ifBlank { user.username }.trim().take(1).uppercase(),
                color = Color(0xFF1E1E3C),
                fontWeight = FontWeight.SemiBold,
                fontSize = 22.sp,
            )
        }
        Column(Modifier.padding(start = 16.dp)) {
            Text(user.name.ifBlank { user.username }, fontWeight = FontWeight.SemiBold, fontSize = 20.sp)
            Text(
                "изменить",
                modifier = Modifier.clickable(role = Role.Button) { renaming = !renaming },
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption("@${user.username}")
        }
    }
    if (renaming) {
        SheetField(name, { name = it }, "Имя")
        if (name.trim() != user.name) {
            ActionPill("Сохранить имя", filled = name.isNotBlank()) {
                if (name.isNotBlank()) {
                    controller.renameMe(name)
                    renaming = false
                }
            }
        }
    }

    MenuRow(
        "Ассистент обо мне",
        profile?.let { "Работа ${workDaysLabel(it.workDays)}, ${formatMinutes(it.workStart)}–${formatMinutes(it.workEnd)}" }.orEmpty(),
    ) {
        controller.accountSheet = false
        controller.openProfile()
    }
    MenuRow("Что ассистент знает", if (facts == 0) "Пока ничего" else pluralize(facts, "факт", "факта", "фактов")) {
        controller.accountSheet = false
        controller.openMemories()
    }

    Caption("Оформление")
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(999.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(4.dp),
    ) {
        listOf("system" to "Как в системе", "light" to "Светлое", "dark" to "Тёмное").forEach { (mode, label) ->
            val on = controller.themeMode == mode
            Box(
                Modifier
                    .weight(1f)
                    .defaultMinSize(minHeight = 44.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(if (on) MaterialTheme.colorScheme.surface else Color.Transparent)
                    .clickable(role = Role.RadioButton) { controller.setTheme(mode) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    fontSize = 14.sp,
                    color = if (on) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }

    MenuRow("Календари", "Google, Яндекс, iCloud, ссылка .ics") {
        controller.accountSheet = false
        controller.openCalendars()
    }
    MenuRow("Люди", "Кого ассистент знает по имени") {
        controller.accountSheet = false
        controller.openPeople()
    }
    MenuRow("Безопасность и данные", "Пароль, устройства, удаление") {
        controller.accountSheet = false
        controller.securitySheet = true
    }

    Caption(if (unread > 0) "Уведомления · ${pluralize(unread, "новое", "новых", "новых")}" else "Уведомления")
    if (controller.notifications.isEmpty()) {
        Text(
            "Пока пусто — когда с вами поделятся задачей, она появится здесь",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 15.sp,
        )
    } else {
        controller.notifications.take(8).forEach { item ->
            Text(
                (if (item.read) "" else "● ") + item.text,
                fontSize = 14.sp,
                fontWeight = if (item.read) FontWeight.Normal else FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
        if (unread > 0) ActionPill("Прочитать все") { controller.markNotificationsRead() }
    }

    if (confirmLogout) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionPill("Выйти", danger = true) {
                confirmLogout = false
                controller.accountSheet = false
                controller.logout()
            }
            ActionPill("Остаться") { confirmLogout = false }
        }
    } else {
        Text(
            "Выйти из аккаунта",
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 48.dp)
                .clickable(role = Role.Button) { confirmLogout = true }
                .padding(12.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            color = MaterialTheme.colorScheme.error,
            fontSize = 16.sp,
        )
    }
}

/** «Безопасность и данные»: пароль, где выполнен вход, удаление аккаунта. */
@Composable
fun SecuritySheet(controller: CalendarController) {
    var passwordOpen by rememberSaveable { mutableStateOf(false) }
    var current by rememberSaveable { mutableStateOf("") }
    var next by rememberSaveable { mutableStateOf("") }
    var deleting by rememberSaveable { mutableStateOf(false) }
    var deletePassword by rememberSaveable { mutableStateOf("") }
    SheetTitle("Безопасность и данные", onClose = { controller.securitySheet = false })

    Caption("Пароль")
    if (passwordOpen) {
        SheetField(current, { current = it }, "Текущий пароль", password = true)
        SheetField(next, { next = it }, "Новый пароль", password = true)
        val ready = current.isNotBlank() && next.length >= 6 && !controller.loading
        ActionPill("Сменить пароль", filled = ready) {
            if (ready) controller.changePassword(current, next) {
                current = ""
                next = ""
                passwordOpen = false
                controller.refreshAccountData()
            }
        }
        if (next.isNotEmpty() && next.length < 6) Text("Не короче 6 символов", color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
    } else {
        ActionPill("Сменить пароль") { passwordOpen = true }
    }

    Caption("Где выполнен вход")
    controller.sessions.forEach { session ->
        Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 44.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                session.label.ifBlank { "Неизвестное устройство" } + if (session.current) " · это устройство" else "",
                modifier = Modifier.weight(1f),
                fontSize = 14.sp,
            )
            if (!session.current) {
                Text(
                    "Выйти",
                    modifier = Modifier.clickable(role = Role.Button) { controller.endSession(session.id) }.padding(12.dp),
                    color = MaterialTheme.colorScheme.error,
                    fontSize = 14.sp,
                )
            }
        }
    }
    if (controller.sessions.any { !it.current }) {
        ActionPill("Выйти на всех остальных устройствах") { controller.logoutOthers() }
    }

    Caption("Мои данные")
    Caption("Выгрузить всё одним файлом можно в веб-версии: Аккаунт → Безопасность и данные.")

    Caption("Удаление")
    if (deleting) {
        Caption("Аккаунт, события, задачи и память исчезнут насовсем. Введите пароль, чтобы подтвердить.")
        SheetField(deletePassword, { deletePassword = it }, "Пароль", password = true)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionPill("Удалить насовсем", danger = true) {
                if (deletePassword.isNotBlank() && !controller.loading) controller.deleteAccount(deletePassword)
            }
            ActionPill("Отмена") {
                deleting = false
                deletePassword = ""
            }
        }
    } else {
        ActionPill("Удалить аккаунт", danger = true) { deleting = true }
    }
}

/** «Что ассистент знает»: список фактов, можно добавить свой и убрать лишнее. */
@Composable
fun MemoriesSheet(controller: CalendarController) {
    var text by rememberSaveable { mutableStateOf("") }
    SheetTitle("Что ассистент знает", onClose = { controller.memorySheet = false })
    Caption("Эти факты ассистент учитывает в ответах. Лишнее можно убрать.")
    SheetField(text, { text = it }, "Например: «Работаю с 10 до 19»")
    if (text.isNotBlank()) {
        ActionPill("Запомнить", filled = true) {
            if (!controller.loading) controller.addMemory(text) { text = "" }
        }
    }
    if (controller.memories.isEmpty()) {
        Text("Пока ничего. Расскажите ассистенту о себе в чате.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    controller.memories.forEach { memory -> MemoryRow(memory) { controller.deleteMemory(memory) } }
}

@Composable
private fun MemoryRow(memory: Memory, onDelete: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(start = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
            Text(memory.text, color = MaterialTheme.colorScheme.onSurface)
            if (memory.source != "user") Text("ассистент заметил сам", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Box(
            Modifier.size(48.dp).clickable(role = Role.Button, onClickLabel = "Забыть", onClick = onDelete),
            contentAlignment = Alignment.Center,
        ) { CloseIcon(size = 16.dp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
