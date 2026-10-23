package app.calendar.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Мягкое затухание содержимого у края прокручиваемой области: подсказывает, что за краем есть ещё,
 * и не режет текст жёсткой линией. [start] и [end] включают край (верх/низ или лево/право),
 * переход плавный. Ставьте раньше `verticalScroll`/`horizontalScroll`.
 */
fun Modifier.fadingEdges(
    vertical: Boolean,
    size: Dp = 24.dp,
    start: Boolean = true,
    end: Boolean = true,
): Modifier = composed {
    val startStrength by animateFloatAsState(if (start) 1f else 0f, softSpring(), label = "fadeStart")
    val endStrength by animateFloatAsState(if (end) 1f else 0f, softSpring(), label = "fadeEnd")
    Modifier
        .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
        .drawWithContent {
            drawContent()
            val length = size.toPx()
            val opaque = Color.Black
            if (vertical) {
                if (startStrength > 0.01f) {
                    drawRect(
                        Brush.verticalGradient(listOf(opaque.copy(alpha = 1f - startStrength), opaque), startY = 0f, endY = length),
                        size = Size(this.size.width, length),
                        blendMode = BlendMode.DstIn,
                    )
                }
                if (endStrength > 0.01f) {
                    drawRect(
                        Brush.verticalGradient(listOf(opaque, opaque.copy(alpha = 1f - endStrength)), startY = this.size.height - length, endY = this.size.height),
                        topLeft = Offset(0f, this.size.height - length),
                        size = Size(this.size.width, length),
                        blendMode = BlendMode.DstIn,
                    )
                }
            } else {
                if (startStrength > 0.01f) {
                    drawRect(
                        Brush.horizontalGradient(listOf(opaque.copy(alpha = 1f - startStrength), opaque), startX = 0f, endX = length),
                        size = Size(length, this.size.height),
                        blendMode = BlendMode.DstIn,
                    )
                }
                if (endStrength > 0.01f) {
                    drawRect(
                        Brush.horizontalGradient(listOf(opaque, opaque.copy(alpha = 1f - endStrength)), startX = this.size.width - length, endX = this.size.width),
                        topLeft = Offset(this.size.width - length, 0f),
                        size = Size(length, this.size.height),
                        blendMode = BlendMode.DstIn,
                    )
                }
            }
        }
}

/** Глазок в поле пароля: показать или спрятать введённое. */
@Composable
fun PasswordEye(shown: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    val haptics = rememberHaptics()
    Box(
        modifier
            .pressable(role = androidx.compose.ui.semantics.Role.Button, onClickLabel = if (shown) "Скрыть пароль" else "Показать пароль") {
                haptics.toggle(!shown)
                onToggle()
            }
            .size(44.dp),
        contentAlignment = Alignment.Center,
    ) {
        EyeIcon(size = 20.dp, color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant, crossed = shown)
    }
}

/** Три точки «ассистент печатает»: прыгают по очереди. При выключенных анимациях система просто покажет их статично. */
@Composable
fun TypingDots(color: Color, modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "typing")
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(3) { index ->
            val lift by transition.animateFloat(
                initialValue = 0f,
                targetValue = 0f,
                animationSpec = infiniteRepeatable(
                    keyframes {
                        durationMillis = 1100
                        0f at (index * 140)
                        1f at (index * 140 + 220)
                        0f at (index * 140 + 440)
                    },
                    RepeatMode.Restart,
                ),
                label = "dot$index",
            )
            Box(
                Modifier
                    .size(7.dp)
                    .graphicsLayer {
                        translationY = -lift * 4.dp.toPx()
                        alpha = 0.45f + 0.55f * lift
                    }
                    .clip(CircleShape)
                    .background(color),
            )
        }
    }
}

/** Пустое состояние: значок, короткий заголовок, пояснение и действия — вместо большого «заголовка-пустышки». */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EmptyState(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    icon: @Composable () -> Unit,
    actions: @Composable () -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(
            Modifier.size(48.dp).clip(CircleShape).background(androidx.compose.material3.MaterialTheme.colorScheme.surface),
            contentAlignment = Alignment.Center,
        ) { icon() }
        androidx.compose.material3.Text(
            title,
            modifier = Modifier.padding(top = 8.dp),
            fontSize = 20.sp,
            fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
            letterSpacing = (-0.3).sp,
            color = androidx.compose.material3.MaterialTheme.colorScheme.onBackground,
        )
        androidx.compose.material3.Text(body, fontSize = 15.sp, color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(
            Modifier.padding(top = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) { actions() }
    }
}
