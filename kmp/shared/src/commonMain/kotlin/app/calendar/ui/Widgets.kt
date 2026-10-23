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

@Composable
fun ErrorBanner(message: String?, onDismiss: () -> Unit) {
    if (message == null) return
    Surface(
        modifier = Modifier.pressable(onClick = onDismiss).fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.error.copy(alpha = 0.12f),
    ) {
        Text(
            message,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodyMedium,
        )
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
        modifier.fillMaxWidth().height(76.dp).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BarSide(label = "Ассистент", ink = ink, active = assistantActive, onClick = onAssistant) {
            InfinityIcon(size = 22.dp, color = ink)
        }
        Box(
            Modifier.weight(1f).height(48.dp).then(if (center == null) Modifier.pressable(role = Role.Button, onClick = onSay) else Modifier),
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
            Modifier.pressable(role = Role.Button, onClickLabel = label, onClick = onClick)
                .size(48.dp)
                .clip(CircleShape)
                .background(ink.copy(alpha = if (active) 0.22f else 0.12f)),
            contentAlignment = Alignment.Center,
        ) { icon() }
        Text(label, color = ink.copy(alpha = 0.8f), fontSize = 10.sp)
    }
}
