package app.calendar

import app.calendar.api.ApiException
import app.calendar.api.CalendarApi
import app.calendar.api.ChatFrame
import app.calendar.api.Outbox
import app.calendar.api.PendingOp
import app.calendar.api.ReadCache
import app.calendar.api.Task
import app.calendar.api.User
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngineConfig
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class RegressionSettings : Settings {
    private val values = mutableMapOf<String, String>()
    override fun get(key: String) = values[key]
    override fun put(key: String, value: String?) {
        if (value == null) values.remove(key) else values[key] = value
    }
}

private fun SessionStore.signIn(name: String) {
    token = name
    saveUser(User(1, name))
}

@OptIn(ExperimentalCoroutinesApi::class)
class SessionRegressionTest {
    @Test
    fun lateEventsCannotReachNewSessionOrCache() = runTest {
        val settings = RegressionSettings()
        val session = SessionStore(settings).apply { signIn("A") }
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val http = HttpClient(MockEngine {
            started.complete(Unit)
            release.await()
            respond("""[{"id":"private-A","title":"Личное A"}]""")
        })
        val cache = ReadCache(settings)
        val api = CalendarApi(http, session, Outbox(settings), cache)
        try {
            val request = async { api.events("2026-10-24") }
            started.await()
            session.clear()
            cache.clear()
            session.signIn("B")
            release.complete(Unit)
            assertFailsWith<CancellationException> { request.await() }
            assertNull(cache.events("2026-10-24"))
            assertEquals("B", session.token)
        } finally { http.close() }
    }

    @Test
    fun lateUnauthorizedCannotLogOutNewSession() = runTest {
        val settings = RegressionSettings()
        val session = SessionStore(settings).apply { signIn("A") }
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val http = HttpClient(MockEngine {
            started.complete(Unit)
            release.await()
            respond("{}", HttpStatusCode.Unauthorized)
        })
        try {
            val api = CalendarApi(http, session, Outbox(settings), ReadCache(settings))
            val request = async { api.tasks() }
            started.await()
            session.clear()
            session.signIn("B")
            release.complete(Unit)
            assertFailsWith<CancellationException> { request.await() }
            assertEquals("B", session.token)
            assertEquals("B", session.loadUser()?.username)
        } finally { http.close() }
    }

    @Test
    fun currentUnauthorizedStillLogsOut() = runTest {
        val settings = RegressionSettings()
        val session = SessionStore(settings).apply { signIn("A") }
        val http = HttpClient(MockEngine { respond("{}", HttpStatusCode.Unauthorized) })
        try {
            val api = CalendarApi(http, session, Outbox(settings), ReadCache(settings))
            assertEquals(401, assertFailsWith<ApiException> { api.tasks() }.status)
            assertNull(session.token)
        } finally { http.close() }
    }

    @Test
    fun identicalUserIdsOnDifferentServersDoNotShareQueue() = runTest {
        val settings = RegressionSettings()
        val session = SessionStore(settings).apply { apiUrl = "https://first.example"; signIn("A") }
        val outbox = Outbox(settings)
        outbox.setOwner(session.ownerKey("1"))
        outbox.enqueue(PendingOp(entity = "event", action = "delete", entityId = "e1", method = "DELETE", path = "/api/events/:id"))
        val sent = mutableListOf<String>()
        val http = HttpClient(MockEngine { request -> sent += request.url.toString(); respond("{}") })
        try {
            session.clear()
            session.apiUrl = "https://second.example"
            session.signIn("B")
            val api = CalendarApi(http, session, outbox, ReadCache(settings))
            api.flushOutbox()
            assertTrue(sent.isEmpty())
            assertEquals(1, outbox.size)
            assertTrue(outbox.setOwner(session.ownerKey("1")))
            assertEquals(0, outbox.size)
        } finally { http.close() }
    }

    @Test
    fun truncatedChatPreservesPartialAnswerAndReportsError() = runTest {
        val settings = RegressionSettings()
        val session = SessionStore(settings).apply { signIn("A") }
        val frames = mutableListOf<ChatFrame>()
        val http = HttpClient(MockEngine { respond("data: {\"type\":\"delta\",\"text\":\"Часть ответа\"}\n\n") }) { installCalendar() }
        try {
            val api = CalendarApi(http, session, Outbox(settings), ReadCache(settings))
            assertEquals("Ответ оборвался", assertFailsWith<ApiException> { api.sendChat("Привет", frames::add) }.message)
            assertEquals(listOf(ChatFrame.Opened, ChatFrame.Delta("Часть ответа")), frames)
        } finally { http.close() }
    }

    @Test
    fun chatWithDoneCompletesSuccessfully() = runTest {
        val settings = RegressionSettings()
        val session = SessionStore(settings).apply { signIn("A") }
        val frames = mutableListOf<ChatFrame>()
        val http = HttpClient(MockEngine { respond("data: {\"type\":\"delta\",\"text\":\"Ответ\"}\n\ndata: {\"type\":\"done\"}\n\n") }) { installCalendar() }
        try {
            CalendarApi(http, session, Outbox(settings), ReadCache(settings)).sendChat("Привет", frames::add)
            assertEquals(ChatFrame.Done, frames.last())
        } finally { http.close() }
    }

    @Test
    fun logoutWaitsForPendingAndAlreadyStartedDeletion() = runTest {
        // Выход до пятисекундного таймера и во время уже летящего DELETE — оба пути должны ждать его ответа.
        for (startTimer in listOf(false, true)) {
            val settings = RegressionSettings()
            val deleteStarted = CompletableDeferred<Unit>()
            val releaseDelete = CompletableDeferred<Unit>()
            val loggedOut = CompletableDeferred<Unit>()
            val http = HttpClient(MockEngine {
                when {
                    it.url.encodedPath == "/api/me" -> respond("""{"id":1,"username":"A"}""")
                    it.method == HttpMethod.Delete -> {
                        deleteStarted.complete(Unit)
                        releaseDelete.await()
                        respond("{}")
                    }
                    it.url.encodedPath == "/api/auth/logout" -> { loggedOut.complete(Unit); respond("{}") }
                    else -> respond("[]")
                }
            })
            try {
                val controller = CalendarController(backgroundScope, settings, http)
                runCurrent()
                SessionStore(settings).signIn("A")
                controller.user = User(1, "A")
                controller.deleteTask(Task(id = "t1", title = "Задача"))
                if (startTimer) { advanceTimeBy(5_000); runCurrent(); deleteStarted.await() }
                controller.logout()
                deleteStarted.await()
                assertFalse(loggedOut.isCompleted)
                assertEquals("A", SessionStore(settings).token)
                releaseDelete.complete(Unit)
                loggedOut.await()
            } finally { http.close() }
        }
    }

    @Test
    fun editedFormsRequireDiscardAndCanKeepEditing() = runTest {
        val http = HttpClient(MockEngine { respond("[]") })
        try {
            val controller = CalendarController(backgroundScope, RegressionSettings(), http)
            controller.openedTask = Task(id = "t1", title = "Задача")
            controller.formDirty = true
            controller.closeForm { controller.openedTask = null }
            assertTrue(controller.discardAction != null)
            assertTrue(controller.openedTask != null)
            controller.keepEditing()
            assertNull(controller.discardAction)
            assertTrue(controller.formDirty)
            controller.closeForm { controller.openedTask = null }
            controller.confirmDiscard()
            assertNull(controller.openedTask)
            assertFalse(controller.formDirty)
        } finally { http.close() }
    }
    @Test
    fun sessionChangeDuringNetworkFailureDoesNotQueueOldMutation() = runTest {
        val settings = RegressionSettings()
        val session = SessionStore(settings).apply { signIn("A") }
        val outbox = Outbox(settings)
        outbox.setOwner(session.ownerKey("1"))
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val http = HttpClient(MockEngine {
            started.complete(Unit)
            release.await()
            throw IllegalStateException("Сеть пропала")
        })
        try {
            val api = CalendarApi(http, session, outbox, ReadCache(settings))
            val request = async { api.deleteEvent("private-A") }
            started.await()
            session.clear()
            session.signIn("B")
            release.complete(Unit)
            assertFailsWith<CancellationException> { request.await() }
            assertEquals(0, outbox.size)
        } finally { http.close() }
    }

    @Test
    fun replayDoesNotSendNextOperationWithNewSession() = runTest {
        val settings = RegressionSettings()
        val session = SessionStore(settings).apply { signIn("A") }
        val outbox = Outbox(settings)
        outbox.setOwner(session.ownerKey("1"))
        for (id in listOf("first", "second")) {
            outbox.enqueue(PendingOp(entity = "event", action = "delete", entityId = id, method = "DELETE", path = "/api/events/:id"))
        }
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val tokens = mutableListOf<String?>()
        val http = HttpClient(MockEngine {
            tokens += it.headers["Authorization"]
            started.complete(Unit)
            release.await()
            respond("{}")
        })
        try {
            val api = CalendarApi(http, session, outbox, ReadCache(settings))
            val replay = async { api.flushOutbox() }
            started.await()
            session.clear()
            session.signIn("B")
            release.complete(Unit)
            assertFailsWith<CancellationException> { replay.await() }
            assertEquals(listOf<String?>("Bearer A"), tokens)
            assertEquals(2, outbox.size)
        } finally { http.close() }
    }

    @Test
    fun controllerCancelsPreviousAccountsHomeLoad() = runTest {
        val settings = RegressionSettings()
        val release = CompletableDeferred<Unit>()
        val started = CompletableDeferred<Unit>()
        val http = HttpClient(MockEngine(MockEngineConfig().apply {
            dispatcher = StandardTestDispatcher(testScheduler)
            addHandler {
                when (it.url.encodedPath) {
                    "/api/auth/login" -> respond("""{"token":"B","user":{"id":2,"username":"B"}}""")
                    "/api/me" -> respond("""{"id":2,"username":"B"}""")
                    "/api/events" -> {
                        if (it.headers["Authorization"] == "Bearer A") {
                            started.complete(Unit)
                            kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) { release.await() }
                            respond("""[{"id":"private-A","title":"Личное A"}]""")
                        } else respond("""[{"id":"private-B","title":"Личное B"}]""")
                    }
                    else -> respond("[]")
                }
            }
        }))
        try {
            val controller = CalendarController(backgroundScope, settings, http)
            runCurrent()
            SessionStore(settings).signIn("A")
            controller.user = User(1, "A")
            controller.load(Screen.Home)
            runCurrent()
            assertTrue(started.isCompleted)
            controller.login("B", "password", false, "")
            runCurrent()
            assertEquals("B", controller.user?.username)
            controller.load(Screen.Home)
            runCurrent()
            assertEquals("private-B", controller.todayEvents.single().id)
            release.complete(Unit)
            runCurrent()
            assertEquals("B", controller.user?.username)
            assertEquals("private-B", controller.todayEvents.single().id)
            assertEquals("private-B", ReadCache(settings).events(app.calendar.domain.isoDate(controller.today()))?.single()?.id)
            assertFalse(controller.loading)
        } finally { release.complete(Unit); http.close() }
    }

    @Test
    fun controllerRetainsPartialReplyAfterCleanEofWithoutDone() = runTest {
        val settings = RegressionSettings()
        val http = HttpClient(MockEngine(MockEngineConfig().apply {
            dispatcher = StandardTestDispatcher(testScheduler)
            addHandler {
                if (it.url.encodedPath == "/api/chat") respond("data: {\"type\":\"delta\",\"text\":\"Часть ответа\"}\n\n")
                else respond("[]")
            }
        })) { installCalendar() }
        try {
            val controller = CalendarController(backgroundScope, settings, http)
            runCurrent()
            SessionStore(settings).signIn("A")
            controller.user = User(1, "A")
            controller.send("Привет")
            runCurrent()
            assertEquals("Ответ оборвался", controller.error)
            assertEquals("Часть ответа", controller.liveReply)
            assertFalse(controller.sending)
        } finally { http.close() }
    }
    @Test
    fun lateChatUnauthorizedCannotLogOutNewSession() = runTest {
        val settings = RegressionSettings()
        val session = SessionStore(settings).apply { signIn("A") }
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val frames = mutableListOf<ChatFrame>()
        val http = HttpClient(MockEngine {
            started.complete(Unit)
            release.await()
            respond("{}", HttpStatusCode.Unauthorized)
        }) { installCalendar() }
        try {
            val api = CalendarApi(http, session, Outbox(settings), ReadCache(settings))
            val request = async { api.sendChat("Привет", frames::add) }
            started.await()
            session.clear()
            session.signIn("B")
            release.complete(Unit)
            assertFailsWith<CancellationException> { request.await() }
            assertTrue(frames.isEmpty())
            assertEquals("B", session.token)
        } finally { http.close() }
    }

}
