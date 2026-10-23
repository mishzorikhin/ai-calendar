package app.calendar

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.calendar.api.CalendarApi
import app.calendar.api.ChatFrame
import app.calendar.api.ChatMessage
import app.calendar.api.ConfirmCard
import app.calendar.api.Event
import app.calendar.api.Task
import app.calendar.api.User
import app.calendar.api.WeekInsights
import app.calendar.domain.isoDate
import app.calendar.domain.parseIsoDate
import app.calendar.domain.startOfWeek
import app.calendar.domain.toolLabel
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.plus
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Clock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.todayIn

sealed interface Screen {
    data object Home : Screen
    data object Month : Screen
    data object Tasks : Screen
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
    var screen by mutableStateOf<Screen>(Screen.Home)
    var todayEvents by mutableStateOf<List<Event>>(emptyList())
    var tasks by mutableStateOf<List<Task>>(emptyList())
    var monthCursor by mutableStateOf(today().let { LocalDate(it.year, it.monthNumber, 1) })
    var monthDots by mutableStateOf<Map<Int, List<String>>>(emptyMap())
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

    private var dayBack: Screen = Screen.Home

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
        weekSheet = true
        refreshWeek()
    }

    fun shiftWeek(delta: Int) {
        weekStart = weekStart.plus(DatePeriod(days = delta * 7))
        refreshWeek()
    }

    fun openDayFromWeek(dateIso: String) {
        weekSheet = false
        open(Screen.Day(parseIsoDate(dateIso)))
    }

    fun refreshWeek() {
        scope.launch {
            weekError = false
            try {
                weekInsights = api.weekInsights(isoDate(weekStart))
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                weekInsights = null
                weekError = true
            }
        }
    }

    fun dismissError() {
        error = null
    }

    fun login(username: String, password: String, register: Boolean, name: String) {
        val url = normalizeUrl(serverUrl)
        if (url == null) {
            error = "Адрес должен начинаться с http:// или https://"
            return
        }
        session.apiUrl = url
        serverUrl = url
        scope.launch {
            guard {
                user = if (register) api.register(username, password, name) else api.login(username, password)
                screen = Screen.Home
            }
        }
    }

    fun checkServer() {
        val url = normalizeUrl(serverUrl)
        if (url == null) {
            error = "Адрес должен начинаться с http:// или https://"
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
            user = null
            screen = Screen.Home
            messages = emptyList()
            confirms = emptyList()
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
                    }
                    Screen.Month -> monthDots = api.monthDots(monthCursor.year, monthCursor.monthNumber)
                    Screen.Tasks -> tasks = api.tasks()
                    Screen.Chat -> {
                        messages = api.messages()
                        confirms = api.confirms()
                    }
                    is Screen.Day -> dayEvents = api.events(isoDate(current.date))
                }
            }
        }
    }

    fun createEvent(date: LocalDate, title: String, start: Int, end: Int, badge: String, allDay: Boolean) {
        scope.launch {
            guard {
                api.createEvent(isoDate(date), title.trim(), start, end, badge, allDay)
                dayEvents = api.events(isoDate(date))
                if (date == today()) todayEvents = dayEvents
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
                dayEvents = api.events(isoDate(date))
                if (date == today()) todayEvents = dayEvents
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
                        is ChatFrame.Confirm -> confirms = confirms + frame.card
                        is ChatFrame.Memory -> memoryNote = frame.lines.joinToString(". ")
                        ChatFrame.Done -> toolStatus = ""
                        is ChatFrame.Failure -> error = frame.message
                    }
                }
                messages = api.messages()
                liveReply = ""
                tasks = runCatching { api.tasks() }.getOrDefault(tasks)
                todayEvents = runCatching { api.events(isoDate(today())) }.getOrDefault(todayEvents)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (!accepted) messages = messages.filterNot { it.id == -1L && it.text == clean }
                error = if (accepted) "Ответ оборвался" else (e.message ?: "Не отправилось")
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

    private suspend fun guard(block: suspend () -> Unit) {
        loading = true
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (session.token == null) user = null
            error = e.message ?: "Что-то пошло не так"
        } finally {
            loading = false
        }
    }
}

private fun normalizeUrl(raw: String): String? {
    val trimmed = raw.trim().trimEnd('/')
    if (trimmed.isEmpty()) return defaultApiUrl()
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return null
    return trimmed
}
