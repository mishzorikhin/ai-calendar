package app.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendar.CalendarController
import app.calendar.api.Integration
import app.calendar.api.Person
import app.calendar.api.Profile
import app.calendar.domain.birthdayFromInput
import app.calendar.domain.birthdayToInput
import app.calendar.domain.formatMinutes
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Composable
private fun Hint(text: String, error: Boolean = false) {
    Text(
        text,
        fontSize = 13.sp,
        color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun Heading(text: String) {
    Text(text, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) { content() }
}

// ---------------------------------------------------------------------------------------------
// Календари
// ---------------------------------------------------------------------------------------------

private fun kindLabel(kind: String): String = when (kind) {
    "google" -> "Google"
    "outlook" -> "Outlook"
    "caldav" -> "CalDAV"
    else -> "Подписка"
}

private class CalDavPreset(val id: String, val label: String, val url: String, val login: String, val hint: String)

private val calDavPresets = listOf(
    CalDavPreset("yandex", "Яндекс", "https://caldav.yandex.ru", "Логин или почта Яндекса", "Нужен пароль приложения: Яндекс ID → Безопасность → Пароли приложений → «Календарь CalDAV»."),
    CalDavPreset("icloud", "iCloud", "https://caldav.icloud.com", "Apple ID", "Нужен пароль приложения: account.apple.com → Вход и безопасность → Пароли приложений."),
    CalDavPreset("nextcloud", "Nextcloud", "", "Логин Nextcloud", "Адрес — https://ваше-облако/remote.php/dav. Пароль приложения: Настройки → Безопасность."),
    CalDavPreset("other", "Другой", "", "Логин", "Подойдёт любой сервер CalDAV: Fastmail, Mail.ru, Radicale, Baïkal. Достаточно адреса сервера."),
)

/** Шторка «Календари»: подключённые, способы подключить и своя лента `.ics`. */
@Composable
fun CalendarsSheet(controller: CalendarController) {
    var view by rememberSaveable { mutableStateOf("list") }
    val info = controller.integrations
    if (view != "list") {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            ActionPill("‹ Назад") {
                controller.found = null
                view = "list"
            }
        }
    } else {
        Heading("Календари")
        Hint("События из других календарей появятся рядом с вашими, а ассистент будет их учитывать.")
    }
    controller.notice?.let { Hint(it) }
    when (view) {
        "caldav" -> CalDavForm(controller) { view = "list" }
        "ics" -> IcsForm(controller) { view = "list" }
        else -> {
            if (info == null) {
                Hint("Загружаю…")
                return
            }
            if (info.items.isNotEmpty()) {
                Hint("Подключены")
                info.items.forEach { item -> IntegrationCard(controller, item) }
            }
            Hint("Подключить")
            if (info.providers.google) ConnectRow("Google Календарь", "Вход через Google, в обе стороны") { controller.connectOAuth("google") }
            if (info.providers.outlook) ConnectRow("Outlook", "Microsoft 365 и Outlook.com") { controller.connectOAuth("outlook") }
            ConnectRow("Яндекс, iCloud и другие", "CalDAV, в обе стороны") { view = "caldav" }
            ConnectRow("Подписка по ссылке", "Адрес .ics — только просмотр") { view = "ics" }
            Hint("Этот календарь в других приложениях")
            FeedCard(controller)
        }
    }
}

@Composable
private fun ConnectRow(title: String, sub: String, onClick: () -> Unit) {
    Column(
        Modifier.pressable(role = Role.Button, onClick = onClick)
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Text(title, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
        Hint(sub)
    }
}

@Composable
private fun IntegrationCard(controller: CalendarController, item: Integration) {
    var confirm by rememberSaveable(item.id) { mutableStateOf(false) }
    Card {
        Text(item.name.ifBlank { kindLabel(item.kind) }, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
        Hint(
            listOf(kindLabel(item.kind), item.account.takeIf { it.isNotBlank() }, if (item.writable) "запись" else "только просмотр", if (item.primary) "основной" else null)
                .filterNotNull()
                .joinToString(" · "),
        )
        if (item.lastError.isNotBlank()) Hint(item.lastError, error = true)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionPill("Обновить") { controller.syncCalendar(item) }
            if (item.writable && !item.primary) ActionPill("Основной") { controller.makePrimary(item) }
        }
        if (confirm) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionPill("Отключить", danger = true) { controller.disconnectCalendar(item) }
                ActionPill("Оставить") { confirm = false }
            }
        } else {
            ActionPill("Отключить", danger = true) { confirm = true }
        }
    }
}

@Composable
private fun FeedCard(controller: CalendarController) {
    val link = controller.feedUrl
    Card {
        if (link == null) {
            Hint("Ссылка на ваш календарь в формате .ics: подписаться можно в Google, Apple или Outlook. Только просмотр.")
            ActionPill("Включить ссылку", filled = true) { controller.resetFeed() }
        } else {
            Hint("Секретная ссылка — не показывайте её другим")
            SelectionContainer { Text(link, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionPill("Открыть") { app.calendar.openUrl(link) }
                ActionPill("Новая ссылка") { controller.resetFeed() }
            }
            ActionPill("Выключить", danger = true) { controller.disableFeed() }
        }
    }
}

@Composable
private fun IcsForm(controller: CalendarController, onDone: () -> Unit) {
    var url by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    Heading("Подписка по ссылке")
    Hint("Адрес календаря .ics (например, «Скопировать ссылку» в настройках календаря). События будут только для просмотра.")
    SheetField(url, { url = it }, "https://…/calendar.ics")
    SheetField(name, { name = it }, "Название — необязательно")
    val ready = url.trim().startsWith("http") && !controller.loading
    ActionPill(if (controller.loading) "Подключаю…" else "Подключить", Modifier.fillMaxWidth(), filled = ready) {
        if (ready) controller.connectIcs(url, name, onDone)
    }
}

@Composable
private fun CalDavForm(controller: CalendarController, onDone: () -> Unit) {
    var presetId by rememberSaveable { mutableStateOf("yandex") }
    var server by rememberSaveable { mutableStateOf("") }
    var login by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var picked by rememberSaveable { mutableStateOf<List<String>?>(null) }
    val preset = calDavPresets.firstOrNull { it.id == presetId } ?: calDavPresets.first()
    val url = preset.url.ifBlank { server.trim() }
    val canSearch = url.isNotBlank() && login.isNotBlank() && password.isNotBlank() && !controller.loading
    val calendars = controller.found

    Heading("Яндекс, iCloud и другие")
    ChoiceRow {
        calDavPresets.forEach { item ->
            ChoicePill(item.label, item.id == presetId) {
                presetId = item.id
                controller.found = null
            }
        }
    }
    Hint(preset.hint)
    if (preset.url.isBlank()) {
        SheetField(server, { server = it; controller.found = null }, "https://cloud.example.com/remote.php/dav")
    }
    SheetField(login, { login = it; controller.found = null }, preset.login)
    SheetField(password, { password = it; controller.found = null }, "Пароль приложения", password = true)

    if (calendars == null) {
        ActionPill(if (controller.loading) "Ищу…" else "Найти календари", Modifier.fillMaxWidth(), filled = canSearch) {
            if (canSearch) {
                controller.discoverCalDav(url, login, password)
            }
        }
        return
    }
    if (calendars.isEmpty()) Hint("Календарей не нашлось", error = true)
    // Записываемый «основной» отмечаем сразу — обычно нужен он.
    val chosen = picked ?: listOfNotNull(calendars.firstOrNull { it.writable }?.url)
    calendars.forEach { calendar ->
        val on = calendar.url in chosen
        Row(
            Modifier.pressable(role = Role.Checkbox) {
                    picked = if (on) chosen - calendar.url else chosen + calendar.url
                }
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(calendar.name.ifBlank { "Календарь" }, color = MaterialTheme.colorScheme.onSurface)
                Hint(if (calendar.writable) "запись" else "только просмотр")
            }
            Text(if (on) "✓" else "○", fontSize = 18.sp, color = MaterialTheme.colorScheme.onSurface)
        }
    }
    val ready = chosen.isNotEmpty() && !controller.loading
    ActionPill(
        if (controller.loading) "Подключаю…" else if (chosen.size > 1) "Подключить ${chosen.size}" else "Подключить",
        Modifier.fillMaxWidth(),
        filled = ready,
    ) {
        if (ready) controller.connectCalDav(url, login, password, calendars.filter { it.url in chosen }, onDone)
    }
}

// ---------------------------------------------------------------------------------------------
// Ассистент обо мне
// ---------------------------------------------------------------------------------------------

private val dayNames = listOf(1 to "Пн", 2 to "Вт", 3 to "Ср", 4 to "Чт", 5 to "Пт", 6 to "Сб", 0 to "Вс")
private val focusOptions = listOf("none" to "Не важно", "morning" to "Утром", "afternoon" to "Днём", "evening" to "Вечером")
private val meetingOptions = listOf(30, 45, 60, 90, 120)
private val bufferOptions = listOf(0, 5, 10, 15, 30)
private val timeOptions = (0 until 48).map { it * 30 }

private fun durationLabel(minutes: Int): String = when {
    minutes < 60 -> "$minutes мин"
    minutes % 60 == 0 -> "${minutes / 60} ч"
    else -> "${minutes / 60},5 ч"
}

@Composable
private fun TimeChoice(value: Int, onChange: (Int) -> Unit) {
    val shown = if (value == 24 * 60) 0 else value
    ChoiceRow {
        timeOptions.forEach { minutes ->
            ChoicePill(formatMinutes(minutes), minutes == shown, reveal = minutes == shown) { onChange(minutes) }
        }
    }
}

private fun ints(values: List<Int>) = JsonArray(values.map { JsonPrimitive(it) })

/** «Ассистент обо мне»: ритм дня, работа, «святые» блоки, манера общения и предложения. */
@Composable
fun ProfileSheet(controller: CalendarController) {
    val loaded = controller.profile
    if (loaded == null) {
        Heading("Ассистент обо мне")
        Hint("Загружаю…")
        return
    }
    val p: Profile = loaded
    val set = { fields: JsonObject -> controller.patchProfile(fields) }
    // Отбой «0:00» в выборе — это полночь в конце дня.
    val night = { minutes: Int -> if (minutes == 0) 24 * 60 else minutes }

    Heading("Ассистент обо мне")
    Hint("С этим ассистент ищет время и подбирает слова. Менять можно и голосом: «теперь работаю с десяти».")

    Hint("Встаю")
    TimeChoice(p.wakeUp) { set(buildJsonObject { put("wakeUp", it) }) }
    Hint("Ложусь")
    TimeChoice(p.bedTime) { set(buildJsonObject { put("bedTime", night(it)) }) }

    Hint("Работаю с")
    TimeChoice(p.workStart) { set(buildJsonObject { put("workStart", it) }) }
    Hint("до")
    TimeChoice(p.workEnd) { set(buildJsonObject { put("workEnd", night(it)) }) }
    Hint("Рабочие дни")
    ChoiceRow {
        dayNames.forEach { (day, label) ->
            val on = day in p.workDays
            ChoicePill(label, on) {
                val next = if (on) p.workDays - day else p.workDays + day
                set(buildJsonObject { put("workDays", ints(next.sorted())) })
            }
        }
    }

    Hint("Лучше думается")
    ChoiceRow {
        focusOptions.forEach { (id, label) -> ChoicePill(label, p.focus == id) { set(buildJsonObject { put("focus", id) }) } }
    }

    Hint("Встречи обычно длятся")
    ChoiceRow {
        meetingOptions.forEach { m -> ChoicePill(durationLabel(m), p.meetingMinutes == m) { set(buildJsonObject { put("meetingMinutes", m) }) } }
    }
    Hint("Перерыв между делами")
    ChoiceRow {
        bufferOptions.forEach { m ->
            ChoicePill(if (m == 0) "Без перерыва" else "$m мин", p.bufferMinutes == m) { set(buildJsonObject { put("bufferMinutes", m) }) }
        }
    }

    ProtectedBlocks(p, set)

    Hint("Как говорить")
    ChoiceRow {
        ChoicePill("На «ты»", p.address == "ty") { set(buildJsonObject { put("address", "ty") }) }
        ChoicePill("На «вы»", p.address == "vy") { set(buildJsonObject { put("address", "vy") }) }
        ChoicePill("Коротко", p.tone == "brief") { set(buildJsonObject { put("tone", "brief") }) }
        ChoicePill("Подробно", p.tone == "detailed") { set(buildJsonObject { put("tone", "detailed") }) }
    }

    AboutField(p.about) { text -> set(buildJsonObject { put("about", text.trim()) }) }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Запоминать из разговоров", color = MaterialTheme.colorScheme.onSurface)
            Hint("Ассистент сам сохраняет факты о вас в памяти")
        }
        Switch(checked = p.memory, onCheckedChange = { on -> set(buildJsonObject { put("memory", on) }) })
    }
    Hint("Предложений ассистента в день")
    ChoiceRow {
        (0..3).forEach { n ->
            ChoicePill(if (n == 0) "Не присылать" else "$n", p.proactive == n) { set(buildJsonObject { put("proactive", n) }) }
        }
    }
}

@Composable
private fun AboutField(about: String, onSave: (String) -> Unit) {
    var draft by rememberSaveable(about) { mutableStateOf(about) }
    Hint("О себе")
    SheetField(draft, { draft = it.take(500) }, "Например: по вторникам забираю сына в 17:00")
    if (draft.trim() != about) ActionPill("Сохранить", filled = true) { onSave(draft) }
}

@Composable
private fun ProtectedBlocks(p: Profile, set: (JsonObject) -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var start by rememberSaveable { mutableStateOf(13 * 60) }
    var end by rememberSaveable { mutableStateOf(14 * 60) }
    fun blocks(list: List<app.calendar.api.ProtectedBlock>) = JsonArray(
        list.map { b ->
            buildJsonObject {
                put("title", b.title)
                put("start", b.start)
                put("end", b.end)
                if (b.days.isNotEmpty()) put("days", ints(b.days))
            }
        },
    )
    Hint("«Святое» время — ассистент его не займёт")
    p.protected.forEachIndexed { index, block ->
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(block.title, color = MaterialTheme.colorScheme.onSurface)
                    Hint("${formatMinutes(block.start)}–${formatMinutes(block.end)}")
                }
                Text(
                    "Убрать",
                    modifier = Modifier.pressable(role = Role.Button) { set(buildJsonObject { put("protected", blocks(p.protected.filterIndexed { i, _ -> i != index })) }) }.padding(12.dp),
                    color = MaterialTheme.colorScheme.error,
                    fontSize = 14.sp,
                )
            }
        }
    }
    SheetField(title, { title = it.take(40) }, "Например: Обед")
    Hint("С")
    TimeChoice(start) { start = it }
    Hint("До")
    TimeChoice(end) { end = if (it == 0) 24 * 60 else it }
    val ready = title.isNotBlank() && end > start
    ActionPill("Добавить блок", filled = ready) {
        if (ready) {
            set(buildJsonObject { put("protected", blocks(p.protected + app.calendar.api.ProtectedBlock(title.trim(), start, end))) })
            title = ""
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Люди
// ---------------------------------------------------------------------------------------------

private val personMeeting = listOf(0, 30, 45, 60, 90, 120)

/** Карточки людей: ассистент узнаёт «Глеба» и знает, где и как долго вы обычно встречаетесь. */
@Composable
fun PeopleSheet(controller: CalendarController) {
    var editing by rememberSaveable { mutableStateOf<Int?>(null) }
    var adding by rememberSaveable { mutableStateOf(false) }
    if (adding || editing != null) {
        val person = controller.people.firstOrNull { it.id == editing }
        PersonForm(controller, person) {
            adding = false
            editing = null
        }
        return
    }
    Heading("Люди")
    Hint("Ассистент узнаёт, о ком речь, и ставит встречи с учётом ваших привычек.")
    if (controller.people.isEmpty()) Hint("Пока никого. Добавьте тех, с кем часто встречаетесь.")
    controller.people.forEach { person ->
        Column(
            Modifier.pressable(role = Role.Button) { editing = person.id }
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            Text(person.name, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
            val sub = listOf(person.relation, person.place).filter { it.isNotBlank() }.joinToString(" · ")
            if (sub.isNotBlank()) Hint(sub)
        }
    }
    ActionPill("Добавить человека", Modifier.fillMaxWidth(), filled = true) { adding = true }
}

@Composable
private fun PersonForm(controller: CalendarController, person: Person?, onDone: () -> Unit) {
    var name by rememberSaveable(person?.id) { mutableStateOf(person?.name.orEmpty()) }
    var aliases by rememberSaveable(person?.id) { mutableStateOf(person?.aliases.orEmpty().joinToString(", ")) }
    var relation by rememberSaveable(person?.id) { mutableStateOf(person?.relation.orEmpty()) }
    var place by rememberSaveable(person?.id) { mutableStateOf(person?.place.orEmpty()) }
    var meeting by rememberSaveable(person?.id) { mutableStateOf(person?.meetingMinutes ?: 0) }
    var birthday by rememberSaveable(person?.id) { mutableStateOf(birthdayToInput(person?.birthday.orEmpty())) }
    var notes by rememberSaveable(person?.id) { mutableStateOf(person?.notes.orEmpty()) }
    var username by rememberSaveable(person?.id) { mutableStateOf(person?.username.orEmpty()) }
    var confirmDelete by rememberSaveable(person?.id) { mutableStateOf(false) }

    ActionPill("‹ Все люди") { onDone() }
    Heading(if (person == null) "Новый человек" else person.name)
    SheetField(name, { name = it.take(80) }, "Имя")
    SheetField(aliases, { aliases = it }, "Ещё зовут — через запятую")
    SheetField(relation, { relation = it.take(80) }, "Кто это: коллега, мама, тренер")
    SheetField(place, { place = it.take(80) }, "Где обычно видитесь")
    Hint("Встреча обычно")
    ChoiceRow {
        personMeeting.forEach { m -> ChoicePill(if (m == 0) "Как обычно" else durationLabel(m), meeting == m) { meeting = m } }
    }
    SheetField(birthday, { birthday = it }, "День рождения: 14.03 или 14.03.1990")
    SheetField(notes, { notes = it.take(500) }, "Заметки")
    SheetField(username, { username = it.trim().removePrefix("@") }, "Логин в календаре — необязательно")

    val ready = name.isNotBlank() && !controller.loading
    ActionPill(if (controller.loading) "Сохраняю…" else "Сохранить", Modifier.fillMaxWidth(), filled = ready) {
        if (ready) {
            val list = aliases.split(',').map { it.trim() }.filter { it.isNotEmpty() }.take(5)
            controller.savePerson(
                person?.id,
                buildJsonObject {
                    put("name", name.trim())
                    put("aliases", JsonArray(list.map { JsonPrimitive(it) }))
                    put("relation", relation.trim())
                    put("place", place.trim())
                    put("meetingMinutes", meeting)
                    put("birthday", birthdayFromInput(birthday))
                    put("notes", notes.trim())
                    put("username", username)
                },
                onDone,
            )
        }
    }
    if (person != null) {
        if (confirmDelete) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionPill("Удалить", danger = true) {
                    controller.deletePerson(person)
                    onDone()
                }
                ActionPill("Оставить") { confirmDelete = false }
            }
        } else {
            ActionPill("Удалить", danger = true) { confirmDelete = true }
        }
    }
}
