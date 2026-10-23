package app.calendar.ui

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Обводка 1.8 в сетке 24, как Svg в src/components/Icons.tsx. */
@Composable
fun StrokeIcon(
    paths: List<String>,
    modifier: Modifier = Modifier,
    size: Dp = 22.dp,
    color: Color = Color.Unspecified,
    circles: List<Triple<Float, Float, Float>> = emptyList(),
    rects: List<RectStroke> = emptyList(),
) {
    val tint = if (color == Color.Unspecified) androidx.compose.material3.LocalContentColor.current else color
    Canvas(Modifier.size(size).then(modifier)) {
        val stroke = Stroke(width = 1.8f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val factor = this.size.minDimension / 24f
        fun DrawScope.drawSvg(data: String) {
            val path = PathParser().parsePathString(data).toPath()
            withTransform({ scale(factor, factor, pivot = Offset.Zero) }) {
                drawPath(path, tint, style = stroke)
            }
        }
        paths.forEach { drawSvg(it) }
        circles.forEach { (cx, cy, r) ->
            drawCircle(tint, radius = r * factor, center = Offset(cx * factor, cy * factor), style = stroke)
        }
        rects.forEach { rect ->
            drawRoundRect(
                tint,
                topLeft = Offset(rect.x * factor, rect.y * factor),
                size = Size(rect.w * factor, rect.h * factor),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(rect.rx * factor),
                style = stroke,
            )
        }
    }
}

data class RectStroke(val x: Float, val y: Float, val w: Float, val h: Float, val rx: Float)

@Composable
fun InfinityIcon(modifier: Modifier = Modifier, size: Dp = 22.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M12 12c-2-2.6-3.6-4-5.4-4a4 4 0 1 0 0 8c1.8 0 3.4-1.4 5.4-4Zm0 0c2 2.6 3.6 4 5.4 4a4 4 0 1 0 0-8c-1.8 0-3.4 1.4-5.4 4Z"), modifier, size, color)

@Composable
fun PlusIcon(modifier: Modifier = Modifier, size: Dp = 22.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M12 5v14M5 12h14"), modifier, size, color)

@Composable
fun CloseIcon(modifier: Modifier = Modifier, size: Dp = 20.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M6.5 6.5l11 11M17.5 6.5l-11 11"), modifier, size, color)

@Composable
fun ArrowRightIcon(modifier: Modifier = Modifier, size: Dp = 13.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M9.5 5.5 16 12l-6.5 6.5"), modifier, size, color)

@Composable
fun ChevronLeftIcon(modifier: Modifier = Modifier, size: Dp = 18.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M14.5 5.5 8 12l6.5 6.5"), modifier, size, color)

@Composable
fun ChevronRightIcon(modifier: Modifier = Modifier, size: Dp = 18.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M9.5 5.5 16 12l-6.5 6.5"), modifier, size, color)

@Composable
fun ChevronDownIcon(modifier: Modifier = Modifier, size: Dp = 16.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("m6.5 9.5 5.5 5.5 5.5-5.5"), modifier, size, color)

@Composable
fun SearchIcon(modifier: Modifier = Modifier, size: Dp = 19.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("m16 16 4 4"), modifier, size, color, circles = listOf(Triple(11f, 11f, 6.5f)))

@Composable
fun CalendarIcon(modifier: Modifier = Modifier, size: Dp = 12.dp, color: Color = Color.Unspecified) =
    StrokeIcon(
        listOf("M8 3.5v4M16 3.5v4M4 10h16"),
        modifier,
        size,
        color,
        rects = listOf(RectStroke(4f, 5.5f, 16f, 14f, 3f)),
    )

@Composable
fun ChartIcon(modifier: Modifier = Modifier, size: Dp = 15.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M5 19.5h14M7.5 16v-5M12 16V7M16.5 16v-3"), modifier, size, color)

@Composable
fun SunIcon(modifier: Modifier = Modifier, size: Dp = 18.dp, color: Color = Color.Unspecified) =
    StrokeIcon(
        listOf("M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"),
        modifier,
        size,
        color,
        circles = listOf(Triple(12f, 12f, 4f)),
    )

@Composable
fun MoonIcon(modifier: Modifier = Modifier, size: Dp = 18.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z"), modifier, size, color)
