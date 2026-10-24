package app.calendar

import app.calendar.api.Event
import app.calendar.api.Outbox
import app.calendar.api.OutboxSender
import app.calendar.api.PendingOp
import app.calendar.api.SendResult
import app.calendar.api.Task
import app.calendar.api.isTempId
import app.calendar.api.mergeDots
import app.calendar.api.mergeEvents
import app.calendar.api.mergeTasks
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlin.test.assertFailsWith
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class MemorySettings : Settings {
    val map = mutableMapOf<String, String>()
    override fun get(key: String): String? = map[key]
    override fun put(key: String, value: String?) {
        if (value == null) map.remove(key) else map[key] = value
    }
}

/** Записывает отправленное и отвечает по заготовке: путь → результат. */
private class FakeSender(private val answer: (String, String, JsonObject?) -> SendResult) : OutboxSender {
    val sent = mutableListOf<Triple<String, String, JsonObject?>>()
    override suspend fun send(method: String, path: String, body: JsonObject?): SendResult {
        sent += Triple(method, path, body)
        return answer(method, path, body)
    }
}

private fun createEvent(temp: String, title: String = "Встреча", date: String = "2026-10-23") = PendingOp(
    entity = "event", action = "create", entityId = temp, tempId = temp, method = "POST", path = "/api/events",
    body = buildJsonObject { put("date", date); put("title", title); put("start", 600); put("end", 660) },
    dedupePath = "/api/events?date=$date", dedupeMatch = listOf("title", "start", "end"),
)

private fun update(id: String, vararg fields: Pair<String, String>, separate: Boolean = false, entity: String = "event") = PendingOp(
    entity = entity, action = "update", entityId = id, method = "PATCH", path = "/api/$entity" + "s/:id",
    body = buildJsonObject { fields.forEach { (k, v) -> put(k, v) } }, separate = separate,
)

private fun delete(id: String, entity: String = "event") = PendingOp(
    entity = entity, action = "delete", entityId = id, method = "DELETE", path = "/api/$entity" + "s/:id",
)

private fun ok(id: String) = SendResult.Ok(buildJsonObject { put("id", id) })

class OutboxTest {
    @Test
    fun updateIsMergedIntoPendingCreate() {
        val outbox = Outbox(MemorySettings())
        outbox.enqueue(createEvent("offline-1"))
        outbox.enqueue(update("offline-1", "title" to "Новое имя"))
        assertEquals(1, outbox.size)
        assertEquals("Новое имя", (outbox.ops.single().body?.get("title") as JsonPrimitive).content)
    }

    @Test
    fun separateUpdatesAreNotMerged() {
        val outbox = Outbox(MemorySettings())
        outbox.enqueue(update("evt-1", "skip" to "2026-10-24", separate = true))
        outbox.enqueue(update("evt-1", "skip" to "2026-10-25", separate = true))
        assertEquals(2, outbox.size)
    }

    @Test
    fun deleteCancelsUnsentCreate() {
        val outbox = Outbox(MemorySettings())
        outbox.enqueue(createEvent("offline-1"))
        outbox.enqueue(update("offline-1", "title" to "x"))
        outbox.enqueue(delete("offline-1"))
        assertEquals(0, outbox.size)
    }

    @Test
    fun deleteDropsEditsButStaysForRealEntity() {
        val outbox = Outbox(MemorySettings())
        outbox.enqueue(update("evt-1", "title" to "x"))
        outbox.enqueue(delete("evt-1"))
        assertEquals(listOf("delete"), outbox.ops.map { it.action })
    }

    @Test
    fun queueSurvivesRestart() {
        val settings = MemorySettings()
        Outbox(settings).enqueue(createEvent("offline-1"))
        val reopened = Outbox(settings)
        assertEquals(1, reopened.size)
        assertEquals("offline-1", reopened.ops.single().entityId)
    }

    @Test
    fun flushMapsTempIdToRealForLaterEdits() = runTest {
        val outbox = Outbox(MemorySettings())
        outbox.enqueue(createEvent("offline-1"))
        // Правка уже летящего create не склеивается с ним — она отдельная операция после него.
        outbox.enqueue(update("evt-9", "title" to "y"))
        outbox.enqueue(update("offline-1", "title" to "z", separate = true))
        val sender = FakeSender { method, path, _ ->
            when {
                method == "GET" -> SendResult.Ok(JsonArray(emptyList()))
                method == "POST" -> ok("evt-77")
                else -> SendResult.Ok(null)
            }
        }
        val result = outbox.flush(sender, userId = null)
        assertEquals(3, result.synced)
        assertEquals(0, outbox.size)
        assertEquals("/api/events/evt-77", sender.sent.last().second)
        assertEquals("evt-77", outbox.resolveId("offline-1"))
    }

    @Test
    fun dedupeFindsEventThatAlreadyReachedServer() = runTest {
        val outbox = Outbox(MemorySettings())
        outbox.enqueue(createEvent("offline-1"))
        val sender = FakeSender { method, _, _ ->
            if (method == "GET") {
                SendResult.Ok(JsonArray(listOf(buildJsonObject { put("id", "evt-5"); put("title", "Встреча"); put("start", 600); put("end", 660) })))
            } else {
                error("POST не должен уходить")
            }
        }
        outbox.flush(sender, null)
        assertEquals(listOf("GET"), sender.sent.map { it.first })
        assertEquals("evt-5", outbox.resolveId("offline-1"))
    }

    @Test
    fun networkErrorStopsAndKeepsOperations() = runTest {
        val outbox = Outbox(MemorySettings())
        outbox.enqueue(update("evt-1", "title" to "a"))
        outbox.enqueue(delete("evt-2"))
        val result = outbox.flush(FakeSender { _, _, _ -> SendResult.Later }, null)
        assertEquals(0, result.synced)
        assertEquals(2, outbox.size)
    }

    @Test
    fun rejectedOperationIsDroppedAndNotFoundCountsAsDone() = runTest {
        val outbox = Outbox(MemorySettings())
        outbox.enqueue(update("evt-1", "title" to "a"))
        outbox.enqueue(delete("evt-2"))
        val sender = FakeSender { _, path, _ -> if (path.endsWith("evt-1")) SendResult.Rejected else SendResult.Missing }
        val result = outbox.flush(sender, null)
        assertEquals(1, result.dropped)
        assertEquals(1, result.synced)
        assertEquals(0, outbox.size)
    }

    @Test
    fun otherUsersOperationsAreNotSent() = runTest {
        val outbox = Outbox(MemorySettings())
        outbox.setOwner("1")
        outbox.enqueue(update("evt-1", "title" to "a"))
        val sender = FakeSender { _, _, _ -> SendResult.Ok(null) }
        outbox.flush(sender, userId = "2")
        assertTrue(sender.sent.isEmpty())
        assertEquals(1, outbox.size)
    }

    @Test
    fun newOwnerWipesQueueButAdoptionKeepsIt() {
        val settings = MemorySettings()
        val first = Outbox(settings)
        first.enqueue(update("evt-1", "title" to "a"))
        // Операция без владельца при запуске с открытой сессией достаётся ей.
        assertFalse(first.setOwner("1", adopt = true))
        assertEquals(1, first.size)
        // Вошёл другой человек — чужое стирается.
        assertTrue(first.setOwner("2"))
        assertEquals(0, first.size)
    }

    @Test
    fun changingOwnerDuringReplayCannotWriteIdsIntoNewQueue() = runTest {
        val outbox = Outbox(MemorySettings())
        outbox.setOwner("https://first.example#1")
        outbox.enqueue(createEvent("offline-1"))
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val replay = async {
            outbox.flush(OutboxSender { method, _, _ ->
                if (method == "GET") SendResult.Ok(JsonArray(emptyList())) else {
                    started.complete(Unit)
                    release.await()
                    ok("old-server-id")
                }
            }, "https://first.example#1")
        }
        started.await()
        outbox.setOwner("https://second.example#1")
        outbox.enqueue(createEvent("offline-new", title = "Новая задача"))
        release.complete(Unit)
        assertFailsWith<CancellationException> { replay.await() }
        assertEquals("offline-1", outbox.resolveId("offline-1"))
        assertEquals("offline-new", outbox.ops.single().tempId)
    }

    @Test
    fun tempIdsAreRecognised() {
        assertTrue(isTempId(app.calendar.api.newTempId()))
        assertFalse(isTempId("evt-1"))
    }
}

class OfflineMergeTest {
    private val iso = "2026-10-23"

    @Test
    fun createdOfflineEventShowsUp() {
        val merged = mergeEvents(emptyList(), listOf(createEvent("offline-1")), iso)
        assertEquals("Встреча", merged.single().title)
        assertEquals(600, merged.single().start)
    }

    @Test
    fun createdEventIsNotShownTwiceOnceServerHasIt() {
        val onServer = Event(id = "evt-1", date = iso, title = "Встреча", start = 600, end = 660)
        assertEquals(1, mergeEvents(listOf(onServer), listOf(createEvent("offline-1")), iso).size)
    }

    @Test
    fun updateDeleteAndSkipAreApplied() {
        val base = listOf(
            Event(id = "a", title = "A", start = 60, end = 120),
            Event(id = "b", title = "B", start = 180, end = 240),
            Event(id = "c", title = "C", start = 300, end = 360),
        )
        val ops = listOf(
            update("a", "title" to "A2"),
            delete("b"),
            update("c", "skip" to iso, separate = true),
        )
        val merged = mergeEvents(base, ops, iso)
        assertEquals(listOf("A2"), merged.map { it.title })
    }

    @Test
    fun taskCreateCheckAndDelete() {
        val base = listOf(Task(id = "t1", title = "Читать", kind = "habit"), Task(id = "t2", title = "Купить"))
        val check = update("t1", "check" to "2026-10-23", entity = "task", separate = true)
        val merged = mergeTasks(base, listOf(check, delete("t2", entity = "task")))
        assertEquals(listOf("2026-10-23"), merged.single().checks)
        assertNull(merged.firstOrNull { it.id == "t2" })
    }

    @Test
    fun monthDotsGainBadgeForUnsentEvent() {
        val dots = mergeDots(mapOf(23 to listOf("work")), listOf(createEvent("offline-1")), 2026, 10)
        assertEquals(listOf("work", "routine"), dots[23])
    }
}
