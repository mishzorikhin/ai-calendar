package app.calendar.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendar.CalendarController
import app.calendar.Screen
import app.calendar.api.ChatMessage
import app.calendar.api.ConfirmCard
import app.calendar.domain.MdBlock
import app.calendar.domain.MdSpan
import app.calendar.domain.parseMarkdown

private val prompts = listOf("Запланировать завтрак", "Найти время вечером", "Что у меня на неделе?")

/** Примеры для пустого чата: что можно попросить. */
private class Idea(val text: String, val icon: @Composable (Color) -> Unit)

private val ideas = listOf(
    Idea("Поставь встречу с Глебом завтра после обеда") { c -> CalendarIcon(size = 18.dp, color = c) },
    Idea("Найди окно на 2 часа вечером") { c -> SearchIcon(size = 18.dp, color = c) },
    Idea("Что у меня на этой неделе?") { c -> ChartIcon(size = 18.dp, color = c) },
    Idea("Добавь задачу: купить подарок") { c -> CheckIcon(size = 18.dp, color = c) },
)

@Composable
fun ChatScreen(controller: CalendarController) {
    val listState = rememberLazyListState()
    val waiting = controller.sending && controller.liveReply.isBlank() && controller.toolStatus.isBlank()
    val status = controller.toolStatus.takeIf { it.isNotBlank() } ?: if (waiting) "Думаю…" else ""
    val started = controller.sending || controller.messages.any { it.role == "user" }
    val total = controller.messages.size + controller.confirms.size +
        (if (controller.liveReply.isNotBlank()) 1 else 0) +
        (if (controller.memoryNote.isNotBlank()) 1 else 0) +
        (if (status.isNotEmpty()) 1 else 0)
    // Новое сообщение и растущий ответ всегда в поле зрения.
    LaunchedEffect(total, controller.liveReply.length) {
        if (total > 0) listState.animateScrollToItem(total - 1)
    }
    val haptics = rememberHaptics()
    // Ответ дописан — лёгкий тик: чувствуется, что ассистент закончил.
    var wasSending by remember { mutableStateOf(false) }
    LaunchedEffect(controller.sending) {
        if (wasSending && !controller.sending) haptics.tick()
        wasSending = controller.sending
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        ChatHeader(
            status = when {
                controller.offline -> "Нет сети"
                status.isNotEmpty() -> status
                else -> "На связи"
            },
            state = when {
                controller.offline -> PresenceState.Offline
                controller.sending -> PresenceState.Busy
                else -> PresenceState.Online
            },
            onClose = { controller.open(Screen.Home) },
        )
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth()
                .fadingEdges(vertical = true, size = 28.dp, start = listState.canScrollBackward, end = listState.canScrollForward),
            state = listState,
            contentPadding = PaddingValues(top = 12.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(controller.messages, key = { "${it.id}:${it.role}" }) {
                Bubble(it, Modifier.animateItem(fadeInSpec = softSpring(), placementSpec = uiSpring()))
            }
            if (!started) {
                item(key = "ideas") { Ideas(onPick = { controller.chatDraft = it }, modifier = Modifier.animateItem()) }
            }
            if (controller.liveReply.isNotBlank()) {
                item(key = "live") { Bubble(ChatMessage(role = "ai", text = controller.liveReply), Modifier.animateItem()) }
            }
            if (status.isNotEmpty()) {
                item(key = "status") { TypingBubble(status, Modifier.animateItem()) }
            }
            if (controller.memoryNote.isNotBlank()) {
                item(key = "memory") { MemoryNote(controller.memoryNote, Modifier.animateItem()) }
            }
            items(controller.confirms, key = { it.id }) { card ->
                ConfirmCardView(card, onDecide = { controller.decide(card, it) }, modifier = Modifier.animateItem())
            }
        }
        if (started && !controller.sending) {
            val promptScroll = rememberScrollState()
            Row(
                Modifier
                    .fadingEdges(vertical = false, size = 28.dp, start = promptScroll.canScrollBackward, end = promptScroll.canScrollForward)
                    .horizontalScroll(promptScroll)
                    .padding(top = 4.dp, bottom = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                prompts.forEach { label ->
                    Text(
                        label,
                        modifier = Modifier.pressable(role = Role.Button, haptic = true) { controller.chatDraft = label }
                            .clip(RoundedCornerShape(999.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        fontSize = 14.sp,
                    )
                }
            }
        } else {
            Box(Modifier.height(12.dp))
        }
    }
}

/** Низ чата: поле ввода и отправка — центр общей нижней панели. Выход — крестик в шапке экрана. */
@Composable
fun ChatBar(controller: CalendarController, modifier: Modifier = Modifier) {
    val ink = barInk(platformInDarkTheme())
    val draft = controller.chatDraft
    val canSend = draft.isNotBlank() && !controller.sending
    val haptics = rememberHaptics()
    val send = {
        if (canSend) {
            haptics.confirm()
            controller.send(draft)
            controller.chatDraft = ""
        }
    }
    Row(
        modifier.fillMaxWidth().height(76.dp).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .weight(1f)
                .height(52.dp)
                .clip(RoundedCornerShape(26.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 18.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            BasicTextField(
                value = draft,
                onValueChange = { controller.chatDraft = it },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send() }),
                textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 16.sp, fontFamily = LocalInter.current),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
                modifier = Modifier.fillMaxWidth(),
                decorationBox = { inner ->
                    if (draft.isEmpty()) Text("Спросите что угодно…", color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    inner()
                },
            )
        }
        // Кнопка «оживает», когда есть что отправлять: пружинно вырастает и темнеет.
        val ready by animateFloatAsState(if (canSend) 1f else 0f, bouncySpring(), label = "sendReady")
        val sendFill by animateColorAsState(if (canSend) MaterialTheme.colorScheme.primary else ink.copy(alpha = 0.12f), label = "sendFill")
        Box(
            Modifier.pressable(enabled = canSend, role = Role.Button, onClickLabel = "Отправить") { send() }
                .graphicsLayer {
                    val grow = 1f + 0.08f * ready
                    scaleX = grow
                    scaleY = grow
                }
                .size(52.dp)
                .clip(CircleShape)
                .background(sendFill),
            contentAlignment = Alignment.Center,
        ) { ArrowUpIcon(size = 22.dp, color = if (canSend) MaterialTheme.colorScheme.onPrimary else ink) }
    }
}

private enum class PresenceState { Online, Busy, Offline }

/** Шапка чата: название, честный статус (в сети, думает, нет сети) и выход. */
@Composable
private fun ChatHeader(status: String, state: PresenceState, onClose: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp, start = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Ассистент", fontSize = 28.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.8).sp, color = MaterialTheme.colorScheme.onBackground)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(
                    Modifier.size(7.dp).clip(CircleShape).background(
                        when (state) {
                            PresenceState.Online -> Color(0xFF4CC46D)
                            PresenceState.Busy -> MaterialTheme.colorScheme.secondary
                            PresenceState.Offline -> Color(0xFFF08B3D)
                        },
                    ),
                )
                Text(
                    status,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp,
                    maxLines = 1,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
        Box(
            Modifier.pressable(role = Role.Button, onClickLabel = "Закрыть чат", haptic = true, onClick = onClose)
                .size(48.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surface),
            contentAlignment = Alignment.Center,
        ) { CloseIcon(size = 18.dp, color = MaterialTheme.colorScheme.onSurface) }
    }
}

/** Пустой чат: вместо пустоты — примеры того, что можно попросить. */
@Composable
private fun Ideas(onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            "Можно попросить",
            modifier = Modifier.padding(start = 6.dp, bottom = 2.dp),
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        ideas.forEachIndexed { index, idea ->
            Row(
                Modifier
                    .appear(index, dy = 12.dp, startDelay = 120, step = 50)
                    .fillMaxWidth()
                    .pressable(role = Role.Button, haptic = true) { onPick(idea.text) }
                    .clip(RoundedCornerShape(20.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    Modifier.size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant),
                    contentAlignment = Alignment.Center,
                ) { idea.icon(MaterialTheme.colorScheme.onSurface) }
                Text(idea.text, modifier = Modifier.weight(1f), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

/** «Ассистент работает»: точки и подпись шага (например, «Ищу свободное время»). */
@Composable
private fun TypingBubble(status: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
        Row(
            Modifier
                .clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 22.dp, bottomStart = 6.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 16.dp, vertical = 14.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            TypingDots(MaterialTheme.colorScheme.onSurfaceVariant)
            if (status != "Думаю…") Text(status, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        }
    }
}

/** «Запомнил: …» — заметная пометка, а не мелкая серая строка. */
@Composable
private fun MemoryNote(note: String, modifier: Modifier = Modifier) {
    Row(
        modifier
            .clip(RoundedCornerShape(999.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        BrainIcon(size = 16.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Запомнил: $note", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
    }
}

/**
 * Карточка подтверждения удаления или массового переноса: заметные кнопки вместо текстовых «ссылок».
 * Кнопки сами дают вибрацию (подтверждение, отказ при удалении).
 */
@Composable
private fun ConfirmCardView(card: ConfirmCard, onDecide: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val label = card.button.ifBlank { "Да" }
    val destructive = label.contains("удал", ignoreCase = true) || label.contains("очист", ignoreCase = true)
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(MaterialTheme.colorScheme.surface).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(card.title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
        if (card.detail.isNotBlank()) {
            Text(card.detail, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionPill("Отмена", Modifier.weight(1f)) { onDecide(false) }
            ActionPill(label, Modifier.weight(1f), filled = !destructive, danger = destructive) { onDecide(true) }
        }
    }
}

@Composable
private fun Bubble(message: ChatMessage, modifier: Modifier = Modifier) {
    val mine = message.role == "user"
    val shape = if (mine) {
        RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomStart = 22.dp, bottomEnd = 6.dp)
    } else {
        RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 22.dp, bottomStart = 6.dp)
    }
    val ink = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    Row(modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Box(
            Modifier
                .widthIn(max = 320.dp)
                .clip(shape)
                .background(if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface)
                .padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            // Свои реплики — как напечатаны; ответы ассистента могут быть с разметкой.
            if (mine) Text(message.text, color = ink, fontSize = 16.sp) else MarkdownText(message.text, ink)
        }
    }
}

/** Ответ ассистента с абзацами, списками, **жирным**, *курсивом* и `кодом`. */
@Composable
private fun MarkdownText(text: String, color: Color) {
    val blocks = remember(text) { parseMarkdown(text) }
    val codeBackground = MaterialTheme.colorScheme.surfaceVariant
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        blocks.forEach { block ->
            when (block) {
                is MdBlock.Paragraph -> Text(styled(block.spans, codeBackground), color = color, fontSize = 16.sp)
                is MdBlock.Heading -> Text(
                    styled(block.spans, codeBackground),
                    color = color,
                    fontSize = when (block.level) {
                        1 -> 20.sp
                        2 -> 18.sp
                        else -> 16.sp
                    },
                    fontWeight = FontWeight.SemiBold,
                )
                is MdBlock.Item -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(block.marker, color = color.copy(alpha = 0.7f), fontSize = 16.sp, modifier = Modifier.widthIn(min = 16.dp))
                    Text(styled(block.spans, codeBackground), color = color, fontSize = 16.sp, modifier = Modifier.weight(1f, fill = false))
                }
            }
        }
    }
}

private fun styled(spans: List<MdSpan>, codeBackground: Color): AnnotatedString = buildAnnotatedString {
    spans.forEach { span ->
        val style = SpanStyle(
            fontWeight = if (span.bold) FontWeight.SemiBold else null,
            fontStyle = if (span.italic) FontStyle.Italic else null,
            fontFamily = if (span.code) FontFamily.Monospace else null,
            background = if (span.code) codeBackground else Color.Unspecified,
        )
        withStyle(style) { append(span.text) }
    }
}
