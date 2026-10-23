package app.calendar.ui

import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
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
import app.calendar.api.ChatMessage

private val prompts = listOf("Запланировать завтрак", "Запланировать встречу", "Найти время вечером")

@Composable
fun ChatScreen(controller: CalendarController) {
    var draft by rememberSaveable { mutableStateOf("") }
    val listState = rememberLazyListState()
    val waiting = controller.sending && controller.liveReply.isBlank() && controller.toolStatus.isBlank()
    val status = controller.toolStatus.takeIf { it.isNotBlank() } ?: if (waiting) "Думаю…" else ""
    val total = controller.messages.size + controller.confirms.size +
        (if (controller.liveReply.isNotBlank()) 1 else 0) +
        (if (controller.memoryNote.isNotBlank()) 1 else 0) +
        (if (status.isNotEmpty()) 1 else 0)
    // Новое сообщение и растущий ответ всегда в поле зрения.
    LaunchedEffect(total, controller.liveReply.length) {
        if (total > 0) listState.animateScrollToItem(total - 1)
    }
    val send = {
        if (draft.isNotBlank() && !controller.sending) {
            controller.send(draft)
            draft = ""
        }
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp)) {
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(controller.messages, key = { "${it.id}:${it.role}" }) { Bubble(it) }
            if (controller.liveReply.isNotBlank()) item { Bubble(ChatMessage(role = "ai", text = controller.liveReply)) }
            if (status.isNotEmpty()) {
                item { Text(status, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
            }
            if (controller.memoryNote.isNotBlank()) {
                item { Text("Запомнил: ${controller.memoryNote}", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp) }
            }
            items(controller.confirms, key = { it.id }) { card ->
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surface).padding(14.dp),
                ) {
                    Text(card.title, fontWeight = FontWeight.SemiBold)
                    if (card.detail.isNotBlank()) Text(card.detail, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row {
                        Text(
                            card.button.ifBlank { "Да" },
                            modifier = Modifier.pressable(role = Role.Button) { controller.decide(card, true) }.defaultMinSize(minHeight = 44.dp).padding(12.dp),
                            color = MaterialTheme.colorScheme.secondary,
                            fontWeight = FontWeight.Medium,
                        )
                        Text("Нет", modifier = Modifier.pressable(role = Role.Button) { controller.decide(card, false) }.defaultMinSize(minHeight = 44.dp).padding(12.dp))
                    }
                }
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            prompts.forEach { label ->
                Text(
                    label,
                    modifier = Modifier.pressable(role = Role.Button) { draft = label }.clip(RoundedCornerShape(999.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 14.dp, vertical = 12.dp),
                    fontSize = 14.sp,
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .weight(1f)
                    .height(52.dp)
                    .clip(RoundedCornerShape(26.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 16.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                androidx.compose.foundation.text.BasicTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { send() }),
                    textStyle = androidx.compose.ui.text.TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 16.sp, fontFamily = LocalInter.current),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { inner ->
                        if (draft.isEmpty()) Text("Сообщение", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        inner()
                    },
                )
            }
            Box(
                Modifier.pressable(enabled = draft.isNotBlank() && !controller.sending, role = Role.Button, onClickLabel = "Отправить") { send() }
                    .padding(start = 8.dp)
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(if (draft.isNotBlank() && !controller.sending) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center,
            ) { Text("›", color = MaterialTheme.colorScheme.onPrimary, fontSize = 26.sp) }
        }
    }
}

@Composable
private fun Bubble(message: ChatMessage) {
    val mine = message.role == "user"
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Text(
            message.text,
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            color = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
            fontSize = 16.sp,
        )
    }
}
