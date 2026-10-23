package app.calendar.api

import app.calendar.Settings
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlin.random.Random

/**
 * Офлайн-очередь мутаций событий и задач — перенос `src/api/outbox.ts`.
 *
 * Запрос, не ушедший до сервера из-за сети, ждёт здесь и повторяется, когда сеть вернётся. Операция хранит и
 * «семантику» (сущность, действие, id — для склейки и показа), и готовый HTTP-запрос для повтора.
 * Правила те же, что на сайте: правки склеиваются, удаление снимает правки и отменяет неотправленное создание,
 * повтор создания сначала ищет след в коллекции (запрос мог дойти без ответа), сетевой сбой, 5xx и 401 останавливают
 * обход, остальные 4xx выбрасывают операцию, 404 на PATCH/DELETE считается выполненным.
 */
@Serializable
data class PendingOp(
    /** Порядковый номер: задаёт порядок повтора. Назначает очередь. */
    val seq: Long = 0,
    /** `event` или `task`. */
    val entity: String,
    /** `create`, `update` или `delete`. */
    val action: String,
    /** Реальный id или временный `offline-*` у только что созданной сущности. */
    val entityId: String,
    val tempId: String? = null,
    val method: String,
    /** Путь запроса; в update и delete вместо id стоит `:id` — подставляется при повторе. */
    val path: String,
    val body: JsonObject? = null,
    /** Для create: перед повтором запросить коллекцию и найти совпадение по [dedupeMatch]. */
    val dedupePath: String? = null,
    val dedupeMatch: List<String> = emptyList(),
    val at: Long = 0,
    /** id пользователя, чья это правка: повтор идёт только от его имени. */
    val owner: String? = null,
    /** Правку нельзя склеивать с другими: «убрать день из серии» и перенос вхождения зависят от своих полей. */
    val separate: Boolean = false,
)

@Serializable
private data class OutboxState(
    val ops: List<PendingOp> = emptyList(),
    /** Временный id → серверный. */
    val ids: Map<String, String> = emptyMap(),
    val owner: String? = null,
    val seq: Long = 0,
)

/** Итог отправки одной операции. */
sealed interface SendResult {
    class Ok(val body: JsonElement?) : SendResult

    /** 404: цель уже удалена. */
    data object Missing : SendResult

    /** Сеть, 5xx или 401: повторим позже, операцию сохраняем. */
    data object Later : SendResult

    /** Другой 4xx: операция не «заживёт» сама — выбрасываем. */
    data object Rejected : SendResult
}

fun interface OutboxSender {
    suspend fun send(method: String, path: String, body: JsonObject?): SendResult
}

data class FlushResult(val synced: Int, val dropped: Int, val remaining: Int)

fun isTempId(id: String): Boolean = id.startsWith(TEMP_PREFIX)

fun newTempId(): String = TEMP_PREFIX + Random.nextLong().toULong().toString(16)

private const val TEMP_PREFIX = "offline-"
private const val KEY_STATE = "outbox"
private const val MAX_IDS = 200

class Outbox(private val settings: Settings) {
    private var state: OutboxState = load()
    private var inFlight: Long? = null
    private val running = Mutex()

    /** Вызывается после каждого изменения очереди — по нему обновляется счётчик в интерфейсе. */
    var onChange: (() -> Unit)? = null

    val ops: List<PendingOp> get() = state.ops
    val size: Int get() = state.ops.size
    val owner: String? get() = state.owner

    /** Серверный id сущности или сам id, если он не временный. */
    fun resolveId(id: String): String = state.ids[id] ?: id

    fun enqueue(op: PendingOp) {
        // Правка неотправленного create или прошлой правки — дописываем поля в её тело. Только в последнюю операцию
        // сущности: если за ней уже стоит правка серии, склейка с более ранней поставила бы новую правку раньше неё.
        if (op.action == "update" && op.body != null && !op.separate) {
            val last = state.ops.lastOrNull { it.seq != inFlight && sameTarget(it, op) }
            val target = last?.takeIf { it.action != "delete" && !it.separate }
            if (target != null) {
                replace(target.copy(body = JsonObject((target.body ?: JsonObject(emptyMap())) + op.body)))
                return
            }
        }
        // Удаление снимает правки; если сущность ещё не уезжала на сервер — отменяет и создание.
        // Летящий create остаётся: он дойдёт до сервера, и удаление должно пойти следом.
        if (op.action == "delete") {
            val pending = state.ops.filter { it.seq != inFlight && sameTarget(it, op) }
            if (pending.isNotEmpty()) {
                commit(state.copy(ops = state.ops - pending.toSet()))
            }
            if (pending.any { it.action == "create" }) return
        }
        val seq = state.seq + 1
        commit(state.copy(ops = state.ops + op.copy(seq = seq, owner = op.owner ?: state.owner), seq = seq))
    }

    /**
     * Повторяет очередь по порядку. [userId] — чья сессия сейчас: чужие операции с её токеном не уходят.
     */
    suspend fun flush(sender: OutboxSender, userId: String?): FlushResult {
        if (!running.tryLock()) return FlushResult(0, 0, size)
        var synced = 0
        var dropped = 0
        try {
            while (true) {
                val op = state.ops.firstOrNull() ?: break
                if (userId != null && (op.owner ?: state.owner) != userId) break
                inFlight = op.seq
                val outcome = try {
                    replay(op, sender)
                } finally {
                    inFlight = null
                }
                if (outcome == Outcome.Retry) break
                commit(state.copy(ops = state.ops.filterNot { it.seq == op.seq }))
                if (outcome == Outcome.Done) synced++ else dropped++
            }
        } finally {
            running.unlock()
        }
        return FlushResult(synced, dropped, size)
    }

    /**
     * Чья это очередь. Вошёл другой человек — операции прошлого стираются: иначе они уехали бы на сервер с его токеном.
     * Выход очередь не трогает: тот же человек войдёт снова и доиграет свои правки. [adopt] — операции без владельца
     * достаются вошедшему, а не стираются (запуск с уже открытой сессией). Возвращает `true`, если очередь стёрта.
     */
    fun setOwner(userId: String, adopt: Boolean = false): Boolean {
        if (state.owner == userId) return false
        val keep = state.owner == null && adopt
        commit(if (keep) state.copy(owner = userId) else OutboxState(owner = userId, seq = state.seq))
        return !keep
    }

    /** Стереть всё: операции, привязки id и владельца (удаление аккаунта). */
    fun wipe() = commit(OutboxState(seq = state.seq))

    private suspend fun replay(op: PendingOp, sender: OutboxSender): Outcome {
        if (op.action == "create") {
            var realId: String? = null
            // Запрос мог дойти до сервера без ответа — сначала ищем след в коллекции.
            if (op.dedupePath != null) {
                when (val found = sender.send("GET", op.dedupePath, null)) {
                    SendResult.Later -> return Outcome.Retry
                    is SendResult.Ok -> realId = findDuplicate(found.body, op)
                    else -> Unit
                }
            }
            if (realId == null) {
                when (val created = sender.send("POST", op.path, op.body)) {
                    SendResult.Later -> return Outcome.Retry
                    is SendResult.Ok -> realId = ((created.body as? JsonObject)?.get("id") as? JsonPrimitive)?.contentOrNull
                    else -> return Outcome.Drop
                }
                if (realId == null) return Outcome.Drop
            }
            op.tempId?.let { remember(it, realId) }
            return Outcome.Done
        }
        val real = resolveId(op.entityId)
        // Создание сущности не состоялось (выброшено) — править и удалять нечего.
        if (isTempId(real)) return Outcome.Drop
        return when (sender.send(op.method, op.path.replace(":id", real), op.body)) {
            SendResult.Later -> Outcome.Retry
            SendResult.Rejected -> Outcome.Drop
            else -> Outcome.Done
        }
    }

    private fun findDuplicate(body: JsonElement?, op: PendingOp): String? {
        val list = body as? JsonArray ?: return null
        val wanted = op.body ?: return null
        val item = list.firstOrNull { item ->
            item is JsonObject && op.dedupeMatch.all { field -> item[field] == wanted[field] }
        } as? JsonObject
        return (item?.get("id") as? JsonPrimitive)?.contentOrNull
    }

    private fun remember(temp: String, real: String) {
        val ids = (state.ids + (temp to real)).entries.toList().takeLast(MAX_IDS).associate { it.key to it.value }
        commit(state.copy(ids = ids))
    }

    private fun sameTarget(a: PendingOp, b: PendingOp) = a.entity == b.entity && a.entityId == b.entityId

    private fun replace(op: PendingOp) = commit(state.copy(ops = state.ops.map { if (it.seq == op.seq) op else it }))

    private fun commit(next: OutboxState) {
        state = next
        settings.put(KEY_STATE, apiJson.encodeToString(next))
        onChange?.invoke()
    }

    private fun load(): OutboxState {
        val raw = settings.get(KEY_STATE) ?: return OutboxState()
        return runCatching { apiJson.decodeFromString<OutboxState>(raw) }.getOrDefault(OutboxState())
    }

    private enum class Outcome { Done, Drop, Retry }
}
