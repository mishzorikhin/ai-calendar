package app.calendar.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

// Пружины переведены из src/lib/motion.ts: dampingRatio = damping / (2 * sqrt(stiffness * mass)).

/** `spring` на сайте: stiffness 420, damping 38, mass 0.9. */
fun <T> uiSpring(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.98f, stiffness = 420f)

/** `softSpring`: stiffness 240, damping 30. */
fun <T> softSpring(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.97f, stiffness = 240f)

/** `bouncy`: stiffness 520, damping 26. */
fun <T> bouncySpring(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.57f, stiffness = 520f)

/**
 * Нажатие как `Pressable` на сайте: элемент пружинно сжимается до [scale].
 * Ставьте первым в цепочке — масштабируется всё, что идёт после (фон, обрезка, содержимое).
 */
fun Modifier.pressable(
    enabled: Boolean = true,
    onClickLabel: String? = null,
    role: Role? = null,
    scale: Float = 0.97f,
    onClick: () -> Unit,
): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val factor by animateFloatAsState(if (pressed && enabled) scale else 1f, bouncySpring())
    Modifier
        .graphicsLayer {
            scaleX = factor
            scaleY = factor
        }
        .clickable(
            interactionSource = source,
            indication = null,
            enabled = enabled,
            onClickLabel = onClickLabel,
            role = role,
            onClick = onClick,
        )
}

/**
 * Появление каскадом, как `itemVariants` на сайте: прозрачность, подъём на [dy] и необязательный
 * рост от [scaleFrom]. Задержка — [startDelay] + [step] на каждый [index].
 */
fun Modifier.appear(
    index: Int = 0,
    dy: Dp = 22.dp,
    startDelay: Long = 30,
    step: Long = 30,
    scaleFrom: Float = 1f,
): Modifier = composed {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(startDelay + step * index)
        progress.animateTo(1f, softSpring())
    }
    Modifier.graphicsLayer {
        val p = progress.value
        alpha = p.coerceIn(0f, 1f)
        translationY = (1f - p) * dy.toPx()
        val grow = scaleFrom + (1f - scaleFrom) * p
        scaleX = grow
        scaleY = grow
    }
}
