package app.calendar

import app.calendar.api.Profile
import app.calendar.api.Person
import app.calendar.api.IntegrationsInfo
import app.calendar.api.Integration
import app.calendar.api.CalDavCalendar
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.calendar.api.CalendarApi
import app.calendar.api.Outbox
import app.calendar.api.ReadCache
import app.calendar.domain.pluralize
import app.calendar.api.ChatFrame
import app.calendar.api.ChatMessage
import app.calendar.api.AppNotification
import app.calendar.api.AuthSession
import app.calendar.api.ConfirmCard
import app.calendar.api.Memory
import app.calendar.api.NewTask
import app.calendar.api.SearchResult
import app.calendar.api.Suggestion
import app.calendar.api.Event
import app.calendar.api.EventExtras
import app.calendar.api.Task
import app.calendar.api.User
import app.calendar.api.WeekInsights
import app.calendar.domain.habitCheckedNow
import app.calendar.domain.habitMarkToClear
import app.calendar.domain.isoDate
import app.calendar.domain.parseIsoDate
import app.calendar.domain.startOfWeek
import app.calendar.domain.toolLabel
import kotlinx.datetime.DatePeriod
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.datetime.plus
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Clock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.todayIn
import kotlinx.datetime.toLocalDateTime

/** Сообщение внизу экрана; [action] — необязательная кнопка («Вернуть»). */
data class Toast(val text: String, val actionLabel: String? = null, val action: (() -> Unit)? = null)

/** Событие, открытое в шторке, и день, на котором на него нажали (у повторов это день вхождения). */
data class OpenedEvent(val event: Event, val date: LocalDate)

sealed interface Screen {
    data object Home : Screen
    data object Month : Screen
    data object Chat : Screen
    data class Day(val date: LocalDate) : Screen
}

class CalendarController(private val scope: CoroutineScope) {
    private val settings = platformSettings()
    private val session = SessionStore(settings)
    private val outbox = Outbox(settings)
    private val cache = ReadCache(settings)
    private val api = CalendarApi(createHttpClient(), session, outbox, cache)

    var user by mutableStateOf<User?>(null)
    /** Последний запрос не достучался до сервера: экран показывает сохранённые данные. */
    var offline by mutableStateOf(false)
        private set
    /** Сколько изменений ещё не уехало на сервер. */
    var pending by mutableStateOf(outbox.size)
        private set
    var booting by mutableStateOf(session.token != null)
    var error by mutableStateOf<String?>(null)
    var loading by mutableStateOf(false)
        private set
    var screen by mutableStateOf<Screen>(Screen.Home)
    var todayEvents by mutableStateOf<List<Event>>(emptyList())
    var tasks by mutableStateOf<List<Task>>(emptyList())
    var monthCursor by mutableStateOf(today().let { LocalDate(it.year, it.monthNumber, 1) })
    var monthDots by mutableStateOf<Map<Int, List<String>>>(emptyMap())
    /** Какому месяцу («2026-10») принадлежат [monthDots]: ответ мог прийти после смены месяца. */
    var monthDotsKey by mutableStateOf<String?>(null)
    var dayEvents by mutableStateOf<List<Event>>(emptyList())
    /** День, которому принадлежат [dayEvents]. */
    var dayEventsDate by mutableStateOf<LocalDate?>(null)
    var messages by mutableStateOf<List<ChatMessage>>(emptyList())
    var confirms by mutableStateOf<List<ConfirmCard>>(emptyList())
    var liveReply by mutableStateOf("")
    var toolStatus by mutableStateOf("")
    var memoryNote by mutableStateOf("")
    var sending by mutableStateOf(false)
    /** Черновик реплики: поле ввода живёт в нижней панели, а не в экране чата. */
    var chatDraft by mutableStateOf("")
    var serverUrl by mutableStateOf(session.apiUrl)
    var composerDate by mutableStateOf<LocalDate?>(null)
    /** Время, на которое нажали на шкале дня: подставляется в редактор нового события. */
    var composerStart by mutableStateOf<Int?>(null)
    var taskSheet by mutableStateOf(false)
    var weekSheet by mutableStateOf(false)
    var weekStart by mutableStateOf(startOfWeek(today()))
    var weekInsights by mutableStateOf<WeekInsights?>(null)
    var weekError by mutableStateOf(false)
    var dayTimeline by mutableStateOf(true)
    var openedEvent by mutableStateOf<OpenedEvent?>(null)
    var openedTask by mutableStateOf<Task?>(null)
    var openedEventEdit by mutableStateOf(false)
    /** Короткое сообщение внизу, у него может быть кнопка («Вернуть»). */
    var toast by mutableStateOf<Toast?>(null)
    /** Повтор последнего неудавшегося запроса экрана — кнопка «Повторить» у плашки ошибки. */
    var errorRetry by mutableStateOf<(() -> Unit)?>(null)
    /** Идёт обновление потягиванием на главной. */
    var refreshing by mutableStateOf(false)
        private set
    /** Главная уже получила данные хотя бы раз: до этого показываем заглушки вместо «пусто». */
    var homeLoaded by mutableStateOf(false)
        private set
    /** Раскрытый слой суток, выбранный руками; `null` — по умолчанию (текущий слой сегодня). */
    var dayOpenPart by mutableStateOf<String?>(null)
    /** В форме есть несохранённый ввод — закрытие спрашивает подтверждение. */
    var formDirty by mutableStateOf(false)
    /** Закрытие формы ждёт ответа «Отбросить?». */
    var discardAction by mutableStateOf<(() -> Unit)?>(null)
    /** Выполненные задачи на главной свёрнуты. */
    var showDoneTasks by mutableStateOf(false)
    var searchSheet by mutableStateOf(false)
    var searchResult by mutableStateOf<SearchResult?>(null)
    var accountSheet by mutableStateOf(false)
    var memorySheet by mutableStateOf(false)
    var notifications by mutableStateOf<List<AppNotification>>(emptyList())
    var sessions by mutableStateOf<List<AuthSession>>(emptyList())
    var memories by mutableStateOf<List<Memory>>(emptyList())
    var suggestions by mutableStateOf<List<Suggestion>>(emptyList())
    var calendarsSheet by mutableStateOf(false)
    var integrations by mutableStateOf<IntegrationsInfo?>(null)
    var feedUrl by mutableStateOf<String?>(null)
    var found by mutableStateOf<List<CalDavCalendar>?>(null)
    var profileSheet by mutableStateOf(false)
    var profile by mutableStateOf<Profile?>(null)
    var peopleSheet by mutableStateOf(false)
    var people by mutableStateOf<List<Person>>(emptyList())
    var notice by mutableStateOf<String?>(null)
    var securitySheet by mutableStateOf(false)
    var themeMode by mutableStateOf(session.theme)
        private set

    private var dayBack: Screen = Screen.Home
    private var inflight = 0
    private var dayWanted: LocalDate? = null

    init {
        outbox.onChange = { pending = outbox.size }
        api.onConnection = { reachable ->
            offline = !reachable
            // Сеть вернулась — доигрываем очередь сразу, не дожидаясь таймера.
            if (reachable && outbox.size > 0) sync()
        }
        scope.launch { restore() }
    }

    /** Повторяет неотправленные изменения; если что-то уехало — обновляет текущий экран. */
    fun sync() {
        if (outbox.size == 0 || (user == null && session.token == null)) return
        scope.launch {
            val result = try {
                api.flushOutbox()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                return@launch
            }
            // Токен мог умереть во время повтора (401): очередь остаётся, вход — заново.
            if (session.token == null && user != null) dropSession()
            if (result.dropped > 0) {
                showToast(pluralize(result.dropped, "изменение не удалось отправить", "изменения не удалось отправить", "изменений не удалось отправить"))
            }
            if (result.synced + result.dropped > 0) load(screen)
        }
    }

    /** Чьё это устройство: чужие неотправленные правки не должны уйти в другой аккаунт. */
    private fun adoptOwner(adopt: Boolean) {
        val id = user?.id?.toString() ?: return
        if (outbox.setOwner(id, adopt)) cache.clear()
    }

    fun today(): LocalDate = Clock.System.todayIn(TimeZone.currentSystemDefault())

    fun nowMinutes(): Int =
        Clock.System.now().toLocalDateTime(TimeZone.currentSystemDefault()).let { it.hour * 60 + it.minute }

    /** События дня, если они уже загружены: по ним подбирается время и показывается пересечение. */
    fun eventsKnownFor(date: LocalDate): List<Event>? = when {
        date == today() && homeLoaded -> todayEvents
        dayEventsDate == date -> dayEvents
        else -> null
    }

    fun compose(date: LocalDate = today(), start: Int? = null) {
        composerStart = start
        composerDate = date
    }

    fun open(next: Screen) {
        // Листание дней лентой недели не должно менять, куда ведёт «закрыть день».
        if (next is Screen.Day && screen !is Screen.Day) dayBack = screen
        screen = next
        error = null
    }

    fun back() {
        screen = dayBack
    }

    fun shiftMonth(delta: Int) {
        monthCursor = app.calendar.domain.shiftMonth(monthCursor, delta)
    }

    fun showMonth(year: Int, month: Int) {
        if (year !in 1970..2100 || month !in 1..12) return
        monthCursor = LocalDate(year, month, 1)
    }

    fun showWeek() {
        weekStart = startOfWeek(today())
        weekInsights = null
        weekSheet = true
        refreshWeek()
    }

    fun shiftWeek(delta: Int) {
        weekStart = weekStart.plus(DatePeriod(days = delta * 7))
        weekInsights = null
        refreshWeek()
    }

    fun openDayFromWeek(dateIso: String) {
        weekSheet = false
        open(Screen.Day(parseIsoDate(dateIso)))
    }

    fun refreshWeek() {
        val requested = weekStart
        scope.launch {
            weekError = false
            try {
                val result = api.weekInsights(isoDate(requested))
                if (requested == weekStart) weekInsights = result
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                if (requested == weekStart) {
                    weekInsights = null
                    weekError = true
                }
            }
        }
    }

    fun dismissError() {
        error = null
        errorRetry = null
    }

    fun showToast(text: String, actionLabel: String? = null, action: (() -> Unit)? = null) {
        toast = Toast(text, actionLabel, action)
    }

    fun dismissToast() {
        toast = null
    }

    /** Закрыть форму: если в ней есть ввод — сначала спросить. */
    fun closeForm(action: () -> Unit) {
        if (formDirty) discardAction = action else action()
    }

    fun confirmDiscard() {
        val action = discardAction
        discardAction = null
        formDirty = false
        action?.invoke()
    }

    fun keepEditing() {
        discardAction = null
    }

    /** Потянули вниз на главной. */
    fun refreshHome() {
        if (refreshing) return
        refreshing = true
        scope.launch {
            try {
                guard { loadHome() }
            } finally {
                refreshing = false
            }
        }
    }

    private suspend fun loadHome() {
        todayEvents = api.events(isoDate(today()))
        tasks = api.tasks()
        suggestions = runCatching { api.suggestions() }.getOrDefault(suggestions)
        homeLoaded = true
    }

    fun login(username: String, password: String, register: Boolean, name: String) {
        val url = normalizeUrl(serverUrl)
        if (url == null) {
            error = URL_HINT
            return
        }
        session.apiUrl = url
        serverUrl = url
        scope.launch {
            guard {
                resetData()
                user = if (register) api.register(username, password, name) else api.login(username, password)
                adoptOwner(adopt = false)
                screen = Screen.Home
            }
        }
    }

    fun checkServer() {
        val url = normalizeUrl(serverUrl)
        if (url == null) {
            error = URL_HINT
            return
        }
        session.apiUrl = url
        serverUrl = url
        scope.launch {
            guard {
                val status = api.health()
                error = if (status == "ok") "Сервер отвечает" else "Сервер ответил: $status"
            }
        }
    }

    fun logout() {
        flushPending()
        scope.launch {
            api.logout()
            dropSession()
        }
    }

    fun load(current: Screen) {
        if (user == null && session.token == null) return
        scope.launch {
            guard(retry = { load(current) }) {
                when (current) {
                    Screen.Home -> loadHome()
                    Screen.Month -> {
                        val cursor = monthCursor
                        val dots = api.monthDots(cursor.year, cursor.monthNumber)
                        if (cursor == monthCursor) {
                            monthDots = dots
                            monthDotsKey = "${cursor.year}-${cursor.monthNumber}"
                        }
                    }
                    Screen.Chat -> {
                        messages = api.messages()
                        confirms = api.confirms()
                    }
                    is Screen.Day -> refreshDay(current.date)
                }
            }
        }
    }

    /** [onDone] вызывается только после успеха: при ошибке шторка остаётся открытой и ввод не пропадает. */
    fun createEvent(
        date: LocalDate,
        title: String,
        start: Int,
        end: Int,
        badge: String,
        allDay: Boolean,
        notes: String = "",
        extras: EventExtras = EventExtras(),
        onDone: () -> Unit = {},
    ) {
        scope.launch {
            guard {
                api.createEvent(isoDate(date), title.trim(), start, end, badge, allDay, notes, extras)
                refreshDay(date)
                onDone()
            }
        }
    }

    fun deleteEvent(event: Event, date: LocalDate) {
        if (event.readOnly) {
            error = "Это событие только для просмотра"
            return
        }
        deferred(
            "Событие удалено",
            hide = {
                dayEvents = dayEvents.filterNot { it.id == event.id }
                todayEvents = todayEvents.filterNot { it.id == event.id }
            },
            commit = {
                api.deleteEvent(event.id)
                refreshDay(date)
            },
            restore = { refreshDay(date) },
        )
    }

    private var pendingJob: Job? = null
    private var pendingCommit: (suspend () -> Unit)? = null

    /** Выполнить уже отложенное удаление сразу (перед новым удалением и выходом). */
    private fun flushPending() {
        val commit = pendingCommit
        pendingJob?.cancel()
        pendingJob = null
        pendingCommit = null
        if (commit != null) scope.launch { guard { commit() } }
    }

    /**
     * Удаление с отменой: запись сразу пропадает с экрана, а на сервере удаляется через пять секунд,
     * если не нажали «Вернуть». Одновременно ждёт одно удаление — предыдущее выполняется сразу.
     */
    private fun deferred(message: String, hide: () -> Unit, commit: suspend () -> Unit, restore: suspend () -> Unit) {
        flushPending()
        hide()
        val job = scope.launch {
            delay(UNDO_MILLIS)
            pendingJob = null
            pendingCommit = null
            guard { commit() }
        }
        pendingJob = job
        pendingCommit = commit
        showToast(message, "Вернуть") {
            job.cancel()
            pendingJob = null
            pendingCommit = null
            scope.launch { guard { restore() } }
        }
    }

    fun toggleTask(task: Task) {
        scope.launch {
            guard {
                val day = today()
                if (task.kind == "habit") {
                    val cadence = task.cadence.ifBlank { "daily" }
                    if (habitCheckedNow(cadence, task.checks, day)) {
                        // Раз в неделю снимаем отметку этой недели, в какой бы день её ни поставили.
                        habitMarkToClear(cadence, task.checks, day)?.let { api.checkHabit(task.id, it, done = false) }
                    } else {
                        api.checkHabit(task.id, isoDate(day), done = true)
                    }
                } else {
                    api.setTaskDone(task.id, !task.done)
                }
                tasks = api.tasks()
            }
        }
    }

    fun addTask(task: NewTask) {
        scope.launch {
            guard {
                api.createTask(task.copy(title = task.title.trim(), note = task.note.trim(), due = task.due.trim()))
                tasks = api.tasks()
                taskSheet = false
            }
        }
    }

    fun send(text: String) {
        val clean = text.trim()
        if (clean.isEmpty() || sending) return
        scope.launch {
            sending = true
            toolStatus = ""
            memoryNote = ""
            liveReply = ""
            val optimistic = messages + ChatMessage(id = -1, role = "user", text = clean)
            messages = optimistic
            var accepted = false
            try {
                api.sendChat(clean) { frame ->
                    when (frame) {
                        ChatFrame.Opened -> accepted = true
                        is ChatFrame.Delta -> liveReply += frame.text
                        is ChatFrame.Tool -> if (frame.status != "done") toolStatus = toolLabel(frame.name)
                        is ChatFrame.Confirm -> if (confirms.none { it.id == frame.card.id }) confirms = confirms + frame.card
                        is ChatFrame.Memory -> memoryNote = frame.lines.joinToString(". ")
                        ChatFrame.Done -> toolStatus = ""
                        is ChatFrame.Failure -> error = frame.message
                    }
                }
                liveReply = ""
                runCatching { api.messages() }.onSuccess { messages = it }
                tasks = runCatching { api.tasks() }.getOrDefault(tasks)
                todayEvents = runCatching { api.events(isoDate(today())) }.getOrDefault(todayEvents)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (session.token == null) {
                    dropSession()
                    error = e.message
                } else {
                    if (!accepted) messages = messages.filterNot { it.id == -1L && it.text == clean }
                    error = if (accepted) "Ответ оборвался" else (e.message ?: "Не отправилось")
                    if (accepted) runCatching { api.messages() }.onSuccess { messages = it }
                }
            } finally {
                sending = false
                toolStatus = ""
            }
        }
    }

    fun decide(card: ConfirmCard, accept: Boolean) {
        scope.launch {
            guard {
                api.decideConfirm(card.id, accept)
                confirms = confirms.filterNot { it.id == card.id }
                messages = api.messages()
            }
        }
    }

    fun dismissNotice() {
        notice = null
    }

    /** [edit] — сразу открыть редактор (кнопка «Изменить» на главной). */
    fun openEvent(event: Event, date: LocalDate, edit: Boolean = false) {
        openedEventEdit = edit
        openedEvent = OpenedEvent(event, date)
    }

    /** Правка события. У повторов передаётся день вхождения, иначе сервер сдвинул бы всю серию не там. */
    fun updateEvent(
        opened: OpenedEvent,
        title: String,
        start: Int,
        end: Int,
        badge: String,
        allDay: Boolean,
        notes: String,
        extras: EventExtras = EventExtras(),
        date: LocalDate = opened.date,
        onDone: () -> Unit = {},
    ) {
        val event = opened.event
        scope.launch {
            guard {
                api.updateEvent(event.id, extras, buildJsonObject {
                    put("title", title.trim())
                    put("start", if (allDay) 0 else start)
                    put("end", if (allDay) 24 * 60 else end)
                    put("badge", badge)
                    put("allDay", allDay)
                    put("notes", notes.trim())
                    if (event.repeat.isNotBlank()) put("occurrence", isoDate(opened.date))
                    if (date != opened.date) put("date", isoDate(date))
                })
                refreshDay(opened.date)
                if (date != opened.date && date == today()) todayEvents = api.events(isoDate(today()))
                onDone()
            }
        }
    }

    /** «Только этот день» у повторяющегося события. */
    fun skipOccurrence(opened: OpenedEvent) {
        scope.launch {
            guard {
                api.updateEvent(opened.event.id, buildJsonObject { put("skip", isoDate(opened.date)) })
                refreshDay(opened.date)
                openedEvent = null
            }
        }
    }

    fun answerInvite(opened: OpenedEvent, status: String) {
        scope.launch {
            guard {
                api.rsvp(opened.event.id, status)
                refreshDay(opened.date)
                openedEvent = null
            }
        }
    }

    fun updateTask(task: Task, title: String, note: String, due: String) {
        scope.launch {
            guard {
                api.updateTask(task.id, buildJsonObject {
                    put("title", title.trim())
                    put("subtitle", note.trim())
                    put("due", due.trim())
                })
                tasks = api.tasks()
                openedTask = null
            }
        }
    }

    fun deleteTask(task: Task) {
        openedTask = null
        deferred(
            if (task.role == "member") "Вы вышли из задачи" else "Задача удалена",
            hide = { tasks = tasks.filterNot { it.id == task.id } },
            commit = {
                api.deleteTask(task.id)
                tasks = api.tasks()
            },
            restore = { tasks = api.tasks() },
        )
    }

    private var searchSeq = 0

    fun search(query: String) {
        val text = query.trim()
        val seq = ++searchSeq
        // Сервер ищет от двух символов.
        if (text.length < 2) {
            searchResult = null
            return
        }
        scope.launch {
            try {
                val found = api.search(text)
                if (seq == searchSeq) searchResult = found
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (seq == searchSeq) error = e.message
            }
        }
    }

    fun closeSearch() {
        searchSheet = false
        searchResult = null
        searchSeq++
    }

    fun openAccount() {
        accountSheet = true
        scope.launch {
            guard {
                notifications = api.notifications()
                sessions = api.sessions()
                profile = runCatching { api.profile() }.getOrDefault(profile)
                memories = runCatching { api.memories() }.getOrDefault(memories)
            }
        }
    }

    /** Обновить уведомления и список устройств, не открывая шторку. */
    fun refreshAccountData() {
        scope.launch {
            guard {
                notifications = api.notifications()
                sessions = api.sessions()
            }
        }
    }

    fun setTheme(mode: String) {
        session.theme = mode
        themeMode = session.theme
    }

    fun deleteAccount(password: String) {
        scope.launch {
            guard {
                api.deleteAccount(password)
                outbox.wipe()
                dropSession()
            }
        }
    }

    fun markNotificationsRead() {
        scope.launch {
            guard {
                api.markNotificationsRead()
                notifications = notifications.map { it.copy(read = true) }
            }
        }
    }

    fun renameMe(name: String) {
        scope.launch { guard { user = api.updateName(name) } }
    }

    fun changePassword(current: String, next: String, onDone: () -> Unit) {
        scope.launch {
            guard {
                api.changePassword(current, next)
                onDone()
            }
        }
    }

    fun endSession(id: String) {
        scope.launch {
            guard {
                api.deleteSession(id)
                sessions = api.sessions()
            }
        }
    }

    fun logoutOthers() {
        scope.launch {
            guard {
                api.logoutOthers()
                sessions = api.sessions()
            }
        }
    }

    // --- Календари --------------------------------------------------------------------------

    fun openCalendars() {
        calendarsSheet = true
        notice = null
        found = null
        scope.launch {
            guard {
                integrations = api.integrations()
                feedUrl = api.feedPath().takeIf { it.isNotBlank() }?.let { session.apiUrl + it }
            }
        }
    }

    private suspend fun reloadCalendars() {
        integrations = api.integrations()
        // События внешних календарей лежат рядом со своими: дни и месяцы устарели.
        runCatching { todayEvents = api.events(isoDate(today())) }
    }

    fun syncCalendar(item: Integration) {
        scope.launch {
            guard {
                api.syncIntegration(item.id)
                reloadCalendars()
                notice = "«${item.name}» обновлён"
            }
        }
    }

    fun makePrimary(item: Integration) {
        scope.launch {
            guard {
                api.updateIntegration(item.id, buildJsonObject { put("primary", true) })
                reloadCalendars()
            }
        }
    }

    fun disconnectCalendar(item: Integration) {
        scope.launch {
            guard {
                api.deleteIntegration(item.id)
                reloadCalendars()
            }
        }
    }

    fun connectIcs(url: String, name: String, onDone: () -> Unit) {
        scope.launch {
            guard {
                api.createIntegration(buildJsonObject {
                    put("kind", "ics")
                    put("url", url.trim())
                    if (name.isNotBlank()) put("name", name.trim())
                })
                reloadCalendars()
                notice = "Подписка подключена"
                onDone()
            }
        }
    }

    fun discoverCalDav(url: String, username: String, password: String) {
        scope.launch {
            guard { found = api.discoverCalDav(url.trim(), username.trim(), password) }
        }
    }

    fun connectCalDav(url: String, username: String, password: String, picked: List<CalDavCalendar>, onDone: () -> Unit) {
        scope.launch {
            guard {
                picked.forEach { calendar ->
                    api.createIntegration(buildJsonObject {
                        put("kind", "caldav")
                        put("url", calendar.url)
                        put("name", calendar.name)
                        put("username", username.trim())
                        put("password", password)
                        put("writable", calendar.writable)
                    })
                }
                reloadCalendars()
                found = null
                notice = if (picked.size == 1) "Подключили «${picked.first().name}»" else "Подключили календарей: ${picked.size}"
                onDone()
            }
        }
    }

    fun connectOAuth(provider: String) {
        scope.launch {
            guard {
                val link = api.startOAuth(provider)
                if (link.isNotBlank()) {
                    openUrl(link)
                    notice = "Войдите в браузере и вернитесь сюда — календарь появится в списке"
                }
            }
        }
    }

    fun resetFeed() {
        scope.launch { guard { feedUrl = session.apiUrl + api.resetFeed() } }
    }

    fun disableFeed() {
        scope.launch {
            guard {
                api.disableFeed()
                feedUrl = null
            }
        }
    }

    // --- Ассистент обо мне ------------------------------------------------------------------

    fun openProfile() {
        profileSheet = true
        scope.launch { guard { profile = api.profile() } }
    }

    fun patchProfile(fields: kotlinx.serialization.json.JsonObject) {
        scope.launch { guard { profile = api.updateProfile(fields) } }
    }

    fun openPeople() {
        peopleSheet = true
        scope.launch { guard { people = api.people() } }
    }

    fun savePerson(id: Int?, fields: kotlinx.serialization.json.JsonObject, onDone: () -> Unit) {
        scope.launch {
            guard {
                if (id == null) api.createPerson(fields) else api.updatePerson(id, fields)
                people = api.people()
                onDone()
            }
        }
    }

    fun deletePerson(person: Person) {
        scope.launch {
            guard {
                api.deletePerson(person.id)
                people = api.people()
            }
        }
    }

    // --- Участники задачи -------------------------------------------------------------------

    fun addMember(task: Task, username: String) {
        scope.launch {
            guard {
                openedTask = api.addTaskMember(task.id, username.trim().removePrefix("@"))
                tasks = api.tasks()
            }
        }
    }

    fun removeMember(task: Task, username: String) {
        scope.launch {
            guard {
                openedTask = api.removeTaskMember(task.id, username)
                tasks = api.tasks()
            }
        }
    }

    fun openMemories() {
        memorySheet = true
        scope.launch { guard { memories = api.memories() } }
    }

    fun addMemory(text: String, onDone: () -> Unit) {
        scope.launch {
            guard {
                api.createMemory(text)
                memories = api.memories()
                onDone()
            }
        }
    }

    fun deleteMemory(memory: Memory) {
        scope.launch {
            guard {
                api.deleteMemory(memory.id)
                memories = api.memories()
            }
        }
    }

    fun acceptSuggestion(suggestion: Suggestion) {
        scope.launch {
            guard {
                api.acceptSuggestion(suggestion.id)
                suggestions = suggestions.filterNot { it.id == suggestion.id }
                if (suggestion.action.type == "chat") {
                    open(Screen.Chat)
                    send(suggestion.action.prompt)
                } else {
                    todayEvents = api.events(isoDate(today()))
                    tasks = api.tasks()
                }
            }
        }
    }

    fun dismissSuggestion(suggestion: Suggestion) {
        scope.launch {
            guard {
                api.dismissSuggestion(suggestion.id)
                suggestions = suggestions.filterNot { it.id == suggestion.id }
            }
        }
    }

    private suspend fun restore() {
        if (session.token == null) {
            booting = false
            return
        }
        try {
            user = api.me()
            session.saveUser(user)
            adoptOwner(adopt = true)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            user = session.loadUser()
            if (user == null) error = e.message else adoptOwner(adopt = true)
        } finally {
            booting = false
        }
        sync()
    }

    /** Свежие события дня. Устаревший ответ (пока листали дни) выбрасывается. */
    private suspend fun refreshDay(date: LocalDate) {
        dayWanted = date
        val events = api.events(isoDate(date))
        if (dayWanted == date) {
            dayEvents = events
            dayEventsDate = date
        }
        if (date == today()) todayEvents = events
    }

    /** Чужие данные не должны мелькать после выхода или смены аккаунта. */
    private fun resetData() {
        todayEvents = emptyList()
        tasks = emptyList()
        dayEvents = emptyList()
        monthDots = emptyMap()
        monthDotsKey = null
        messages = emptyList()
        chatDraft = ""
        homeLoaded = false
        toast = null
        formDirty = false
        discardAction = null
        pendingJob?.cancel()
        pendingJob = null
        pendingCommit = null
        confirms = emptyList()
        liveReply = ""
        toolStatus = ""
        memoryNote = ""
        weekInsights = null
        weekSheet = false
        taskSheet = false
        composerDate = null
        openedEvent = null
        openedTask = null
        searchSheet = false
        searchResult = null
        accountSheet = false
        memorySheet = false
        notifications = emptyList()
        sessions = emptyList()
        memories = emptyList()
        suggestions = emptyList()
        calendarsSheet = false
        integrations = null
        feedUrl = null
        found = null
        profileSheet = false
        profile = null
        peopleSheet = false
        people = emptyList()
        notice = null
        securitySheet = false
    }

    private fun dropSession() {
        // Закэшированные ответы личные — на устройстве они не остаются. Очередь остаётся: тот же человек доиграет её.
        cache.clear()
        user = null
        screen = Screen.Home
        resetData()
    }

    private suspend fun guard(retry: (() -> Unit)? = null, block: suspend () -> Unit) {
        inflight++
        loading = true
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (session.token == null) {
                dropSession()
            }
            error = e.message ?: "Что-то пошло не так"
            errorRetry = retry
        } finally {
            inflight--
            loading = inflight > 0
        }
    }
}

private const val UNDO_MILLIS = 5_000L

private const val URL_HINT = "Адрес — https://… (http:// только для локальной сети)"

private fun normalizeUrl(raw: String): String? {
    val trimmed = raw.trim().trimEnd('/')
    if (trimmed.isEmpty()) return defaultApiUrl()
    if (trimmed.startsWith("https://")) return trimmed
    if (!trimmed.startsWith("http://")) return null
    val host = trimmed.removePrefix("http://").substringBefore('/').substringBefore(':')
    return trimmed.takeIf { isLocalHost(host) }
}

/** Пароль и токен не должны уходить по открытому каналу в интернет: HTTP — только свой компьютер и своя сеть. */
internal fun isLocalHost(host: String): Boolean {
    if (host == "localhost" || host.endsWith(".local")) return true
    val parts = host.split('.').mapNotNull { it.toIntOrNull() }
    if (parts.size != 4 || host.split('.').size != 4) return false
    val (a, b) = parts
    return a == 127 || a == 10 || (a == 192 && b == 168) || (a == 172 && b in 16..31)
}
