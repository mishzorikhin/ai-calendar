package app.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import app.calendar.Toast
import kotlinx.coroutines.delay
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.fadeOut
import androidx.compose.animation.fadeIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendar.Screen
import app.calendar.api.Event
import app.calendar.domain.badgeLabel
import app.calendar.domain.formatRange
import app.calendar.domain.pluralize

/** Плашка ошибки: сама исчезает через несколько секунд; у запроса, который можно повторить, есть «Повторить». */
@Composable
fun ErrorBanner(message: String?, onDismiss: () -> Unit, onRetry: (() -> Unit)? = null) {
    if (message == null) return
    LaunchedEffect(message) {
        delay(6_000)
        onDismiss()
    }
    Surface(
        modifier = Modifier.pressable(onClick = onDismiss).fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.error.copy(alpha = 0.12f),
    ) {
        Row(Modifier.padding(start = 14.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                message,
                modifier = Modifier.weight(1f).padding(vertical = 12.dp),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (onRetry != null) {
                Text(
                    "Повторить",
                    modifier = Modifier.pressable(role = Role.Button) { onRetry() }.defaultMinSize(minHeight = 44.dp).padding(horizontal = 12.dp, vertical = 12.dp),
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                )
            }
        }
    }
}

/** Тонкая полоса вверху, пока идёт запрос; показывается не сразу, чтобы быстрые запросы не мигали. */
@Composable
fun LoadingBar(active: Boolean, modifier: Modifier = Modifier) {
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(active) {
        if (active) {
            delay(350)
            visible = true
        } else {
            visible = false
        }
    }
    AnimatedVisibility(visible, modifier = modifier, enter = fadeIn(), exit = fadeOut()) {
        LinearProgressIndicator(
            modifier = Modifier.fillMaxWidth().height(2.dp),
            color = MaterialTheme.colorScheme.onBackground,
            trackColor = Color.Transparent,
        )
    }
}

/** Сообщение внизу экрана с необязательной кнопкой («Вернуть»); само пропадает через пять секунд. */
@Composable
fun ToastHost(toast: Toast?, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    LaunchedEffect(toast) {
        if (toast != null) {
            delay(5_000)
            onDismiss()
        }
    }
    Box(modifier.fillMaxWidth().padding(horizontal = 16.dp), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(
            visible = toast != null,
            enter = fadeIn(softSpring()) + slideInVertically(softSpring()) { it / 2 },
            exit = fadeOut() + slideOutVertically { it / 2 },
        ) {
            // Пока плашка уезжает, текст остаётся прежним.
            val shown = remember(toast) { toast }
            Row(
                Modifier
                    .clip(RoundedCornerShape(18.dp))
                    .background(MaterialTheme.colorScheme.primary)
                    .padding(start = 18.dp, end = 6.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(shown?.text.orEmpty(), color = MaterialTheme.colorScheme.onPrimary, fontSize = 15.sp, modifier = Modifier.padding(vertical = 14.dp).weight(1f, fill = false))
                if (shown?.actionLabel != null) {
                    Text(
                        shown.actionLabel,
                        modifier = Modifier.pressable(role = Role.Button) {
                            shown.action?.invoke()
                            onDismiss()
                        }.defaultMinSize(minHeight = 48.dp).padding(horizontal = 14.dp, vertical = 14.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                    )
                }
            }
        }
    }
}

/** «Отбросить введённое?» — когда форму с текстом закрывают случайным жестом. */
@Composable
fun DiscardPrompt(visible: Boolean, onDiscard: () -> Unit, onKeep: () -> Unit) {
    AnimatedVisibility(visible, enter = fadeIn(), exit = fadeOut()) {
        Box(
            Modifier.fillMaxSize().background(sheetScrim(platformInDarkTheme()))
                .clickable(interactionSource = null, indication = null, onClick = onKeep),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                Modifier
                    .padding(24.dp)
                    .clip(RoundedCornerShape(28.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .clickable(interactionSource = null, indication = null) {}
                    .padding(22.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("Отбросить введённое?", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                Text("Название и заметки пропадут.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 15.sp)
                Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ActionPill("Отбросить", Modifier.weight(1f), danger = true) { onDiscard() }
                    ActionPill("Остаться", Modifier.weight(1f), filled = true) { onKeep() }
                }
            }
        }
    }
}

/**
 * Плашка состояния сети, как `OfflineBadge` на сайте: без сети — сколько изменений ждёт отправки,
 * онлайн с непустой очередью — «Синхронизация изменений…».
 */
@Composable
fun OfflineBadge(offline: Boolean, pending: Int, modifier: Modifier = Modifier) {
    val text = when {
        offline && pending > 0 -> "Нет сети · " + pluralize(pending, "изменение ждёт", "изменения ждут", "изменений ждут")
        offline -> "Нет сети · сохранённые данные"
        else -> "Синхронизация изменений…"
    }
    // Пока плашка уезжает, текст остаётся прежним.
    var shown by remember { mutableStateOf(text) }
    if (offline || pending > 0) shown = text
    AnimatedVisibility(
        visible = offline || pending > 0,
        modifier = modifier,
        enter = fadeIn(softSpring()) + slideInVertically(softSpring()) { -it },
        exit = fadeOut() + slideOutVertically { -it },
    ) {
        Row(
            Modifier
                .padding(top = 6.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = 14.dp, vertical = 7.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(Modifier.size(7.dp).clip(CircleShape).background(if (offline) Color(0xFFF08B3D) else Color(0xFF4CC46D)))
            Text(shown, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
fun PrimaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
        ),
    ) {
        Text(text, modifier = Modifier.padding(vertical = 6.dp))
    }
}

@Composable
fun EventRow(event: Event, onClick: (() -> Unit)? = null) {
    val click = if (onClick == null) Modifier else Modifier.pressable(onClick = onClick)
    Surface(
        modifier = Modifier.fillMaxWidth().then(click),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(width = 4.dp, height = 36.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(badgeColor(event.badge)),
            )
            Column(Modifier.padding(start = 12.dp).weight(1f)) {
                Text(event.title.ifBlank { "Без названия" }, style = MaterialTheme.typography.titleMedium)
                val place = event.subtitle.ifBlank { badgeLabel(event.badge) }
                Text(place, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(
                formatRange(event.start, event.end, event.allDay),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun ActionBar(
    assistantActive: Boolean,
    onAssistant: () -> Unit,
    onSay: () -> Unit,
    onCreate: () -> Unit,
    modifier: Modifier = Modifier,
    center: (@Composable () -> Unit)? = null,
) {
    val ink = barInk(platformInDarkTheme())
    Row(
        modifier.fillMaxWidth().height(84.dp).padding(start = 14.dp, end = 14.dp, top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BarSide(label = "Ассистент", ink = ink, active = assistantActive, onClick = onAssistant) {
            InfinityIcon(size = 22.dp, color = ink)
        }
        Box(
            Modifier.weight(1f).height(52.dp).then(if (center == null) Modifier.pressable(role = Role.Button, haptic = true, onClick = onSay) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            if (center != null) center() else Text("Спросить ассистента", color = ink.copy(alpha = 0.85f), fontSize = 15.sp)
        }
        BarSide(label = "Событие", ink = ink, active = false, onClick = onCreate) {
            PlusIcon(size = 22.dp, color = ink)
        }
    }
}

@Composable
private fun BarSide(label: String, ink: Color, active: Boolean, onClick: () -> Unit, icon: @Composable () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.pressable(role = Role.Button, onClickLabel = label, haptic = true, onClick = onClick)
                .size(48.dp)
                .clip(CircleShape)
                .background(ink.copy(alpha = if (active) 0.22f else 0.12f)),
            contentAlignment = Alignment.Center,
        ) { icon() }
        Text(label, color = ink.copy(alpha = 0.8f), fontSize = 10.sp)
    }
}
