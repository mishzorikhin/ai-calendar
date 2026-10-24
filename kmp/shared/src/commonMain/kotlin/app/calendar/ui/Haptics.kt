package app.calendar.ui

import androidx.compose.animation.core.animateIntAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize

/**
 * Вибрация отклика. На вебе, в JVM и iOS без поддержки вызовы ничего не делают.
 * Короткие «тики» — на выборе и листании, «подтверждение» и «отказ» — на действиях.
 */
class Haptics(private val feedback: HapticFeedback) {
    fun tick() = feedback.performHapticFeedback(HapticFeedbackType.SegmentTick)
    fun confirm() = feedback.performHapticFeedback(HapticFeedbackType.Confirm)
    fun reject() = feedback.performHapticFeedback(HapticFeedbackType.Reject)
    fun toggle(on: Boolean) =
        feedback.performHapticFeedback(if (on) HapticFeedbackType.ToggleOn else HapticFeedbackType.ToggleOff)
    fun threshold() = feedback.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
    fun end() = feedback.performHapticFeedback(HapticFeedbackType.GestureEnd)
}

@Composable
fun rememberHaptics(): Haptics {
    val feedback = LocalHapticFeedback.current
    return remember(feedback) { Haptics(feedback) }
}

/** Положения вариантов выбора внутри контейнера — по ним плашка скользит к выбранному, как `layoutId` на сайте. */
class KnobBounds {
    internal val items = mutableStateMapOf<Int, Pair<Offset, IntSize>>()
    internal var origin = Offset.Zero

    /** Контейнер: от его угла отсчитываются положения вариантов. */
    fun container(): Modifier = Modifier.onGloballyPositioned { origin = it.positionInRoot() }

    /** Вариант выбора с номером [index]. */
    fun item(index: Int): Modifier =
        Modifier.onGloballyPositioned { items[index] = it.positionInRoot() to it.size }
}

@Composable
fun rememberKnobBounds(): KnobBounds = remember { KnobBounds() }

/** Плашка под выбранным вариантом; ставится в контейнер раньше вариантов, чтобы лежать под ними. */
@Composable
fun SlidingKnob(bounds: KnobBounds, selected: Int, color: Color, shape: Shape) {
    val (position, size) = bounds.items[selected] ?: return
    val local = position - bounds.origin
    val x by animateIntAsState(local.x.toInt(), uiSpring(), label = "knobX")
    val y by animateIntAsState(local.y.toInt(), uiSpring(), label = "knobY")
    val w by animateIntAsState(size.width, uiSpring(), label = "knobW")
    val h by animateIntAsState(size.height, uiSpring(), label = "knobH")
    val density = LocalDensity.current
    Box(
        Modifier
            .offset { IntOffset(x, y) }
            .size(with(density) { w.toDp() }, with(density) { h.toDp() })
            .clip(shape)
            .background(color),
    )
}
