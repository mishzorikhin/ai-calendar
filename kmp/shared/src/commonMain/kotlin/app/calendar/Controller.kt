package app.calendar

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.calendar.api.CalendarApi
import app.calendar.api.ChatFrame
import app.calendar.api.ChatMessage
import app.calendar.api.AppNotification
import app.calendar.api.AuthSession
import app.calendar.api.ConfirmCard
import app.calendar.api.Memory
import app.calendar.api.SearchResult
import app.calendar.api.Suggestion
import app.calendar.api.Event
import app.calendar.api.Task
import app.calendar.api.User
import app.calendar.api.WeekInsights
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
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.todayIn

/** Событие, открытое в шторке, и день, на котором на него нажали (у повторов это день вхождения). */
data class OpenedEvent(val event: Event, val date: LocalDate)

sealed interface Screen {
    data object Home : Screen
    data object Month : Screen
    data object Chat : Screen
    data class Day(val date: LocalDate) : Screen
}

class CalendarController(private val scope: CoroutineScope) {
    private val session = SessionStore(platformSettings())
    private val api = CalendarApi(createHttpClient(), session)

    var user by mutableStateOf<User?>(null)
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
    var messages by mutableStateOf<List<ChatMessage>>(emptyList())
    var confirms by mutableStateOf<List<ConfirmCard>>(emptyList())
    var liveReply by mutableStateOf("")
    var toolStatus by mutableStateOf("")
    var memoryNote by mutableStateOf("")
    var sending by mutableStateOf(false)
    var serverUrl by mutableStateOf(session.apiUrl)
    var composerDate by mutableStateOf<LocalDate?>(null)
    var taskSheet by mutableStateOf(false)
    var weekSheet by mutableStateOf(false)
    var weekStart by mutableStateOf(startOfWeek(today()))
    var weekInsights by mutableStateOf<WeekInsights?>(null)
    var weekError by mutableStateOf(false)
    var dayTimeline by mutableStateOf(true)
    var openedEvent by mutableStateOf<OpenedEvent?>(null)
    var openedTask by mutableStateOf<Task?>(null)
    var searchSheet by mutableStateOf(false)
    var searchResult by mutableStateOf<SearchResult?>(null)
    var accountSheet by mutableStateOf(false)
    var memorySheet by mutableStateOf(false)
    var notifications by mutableStateOf<List<AppNotification>>(emptyList())
    var sessions by mutableStateOf<List<AuthSession>>(emptyList())
    var memories by mutableStateOf<List<Memory>>(emptyList())
    var suggestions by mutableStateOf<List<Suggestion>>(emptyList())

    private var dayBack: Screen = Screen.Home
    private var inflight = 0
    private var dayWanted: LocalDate? = null

    init {
        scope.launch { restore() }
    }

    fun today(): LocalDate = Clock.System.todayIn(TimeZone.currentSystemDefault())

    fun compose(date: LocalDate = today()) {
        composerDate = date
    }

    fun open(next: Screen) {
        if (next is Screen.Day) dayBack = screen
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
        scope.launch {
            api.logout()
            dropSession()
        }
    }

    fun load(current: Screen) {
        if (user == null && session.token == null) return
        scope.launch {
            guard {
                when (current) {
                    Screen.Home -> {
                        todayEvents = api.events(isoDate(today()))
                        tasks = api.tasks()
                        suggestions = runCatching { api.suggestions() }.getOrDefault(suggestions)
                    }
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
    fun createEvent(date: LocalDate, title: String, start: Int, end: Int, badge: String, allDay: Boolean, notes: String = "", onDone: () -> Unit = {}) {
        scope.launch {
            guard {
                api.createEvent(isoDate(date), title.trim(), start, end, badge, allDay, notes)
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
        scope.launch {
            guard {
                api.deleteEvent(event.id)
                refreshDay(date)
            }
        }
    }

    fun toggleTask(task: Task) {
        scope.launch {
            guard {
                val date = isoDate(today())
                if (task.kind == "habit") api.checkHabit(task.id, date, done = date !in task.checks)
                else api.setTaskDone(task.id, !task.done)
                tasks = api.tasks()
            }
        }
    }

    fun addTask(title: String, subtitle: String = "", kind: String = "task") {
        scope.launch {
            guard {
                api.createTask(title.trim(), subtitle.trim(), kind)
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

    fun openEvent(event: Event, date: LocalDate) {
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
        onDone: () -> Unit = {},
    ) {
        val event = opened.event
        scope.launch {
            guard {
                api.updateEvent(event.id, buildJsonObject {
                    put("title", title.trim())
                    put("start", if (allDay) 0 else start)
                    put("end", if (allDay) 24 * 60 else end)
                    put("badge", badge)
                    put("allDay", allDay)
                    put("notes", notes.trim())
                    if (event.repeat.isNotBlank()) put("occurrence", isoDate(opened.date))
                })
                refreshDay(opened.date)
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
        scope.launch {
            guard {
                api.deleteTask(task.id)
                tasks = api.tasks()
                openedTask = null
            }
        }
    }

    private var searchSeq = 0

    fun search(query: String) {
        val text = query.trim()
        val seq = ++searchSeq
        if (text.isEmpty()) {
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
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            user = session.loadUser()
            if (user == null) error = e.message
        } finally {
            booting = false
        }
    }

    /** Свежие события дня. Устаревший ответ (пока листали дни) выбрасывается. */
    private suspend fun refreshDay(date: LocalDate) {
        dayWanted = date
        val events = api.events(isoDate(date))
        if (dayWanted == date) dayEvents = events
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
    }

    private fun dropSession() {
        user = null
        screen = Screen.Home
        resetData()
    }

    private suspend fun guard(block: suspend () -> Unit) {
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
        } finally {
            inflight--
            loading = inflight > 0
        }
    }
}

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
