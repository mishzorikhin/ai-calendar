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
        // Путь рисуется под масштабом и толстеет вместе с ним; круги и прямоугольники — без него.
        val scaled = Stroke(width = 1.8f * factor, cap = StrokeCap.Round, join = StrokeJoin.Round)
        circles.forEach { (cx, cy, r) ->
            drawCircle(tint, radius = r * factor, center = Offset(cx * factor, cy * factor), style = scaled)
        }
        rects.forEach { rect ->
            drawRoundRect(
                tint,
                topLeft = Offset(rect.x * factor, rect.y * factor),
                size = Size(rect.w * factor, rect.h * factor),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(rect.rx * factor),
                style = scaled,
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

// Остальные значки — те же пути, что в src/components/Icons.tsx.

@Composable
fun CheckIcon(modifier: Modifier = Modifier, size: Dp = 16.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("m5.5 12.5 4 4 9-9"), modifier, size, color)

@Composable
fun TimelineIcon(modifier: Modifier = Modifier, size: Dp = 16.dp, color: Color = Color.Unspecified) =
    StrokeIcon(emptyList(), modifier, size, color, rects = listOf(RectStroke(5f, 4f, 14f, 6f, 2f), RectStroke(5f, 14f, 14f, 6f, 2f)))

@Composable
fun AgendaIcon(modifier: Modifier = Modifier, size: Dp = 16.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M17.5 8.5v7M20.5 10v4"), modifier, size, color, rects = listOf(RectStroke(3.5f, 5.5f, 10f, 13f, 2.5f)))

@Composable
fun EyeIcon(modifier: Modifier = Modifier, size: Dp = 20.dp, color: Color = Color.Unspecified, crossed: Boolean = false) =
    StrokeIcon(
        listOfNotNull("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z", "M4.5 4.5l15 15".takeIf { crossed }),
        modifier, size, color,
        circles = if (crossed) emptyList() else listOf(Triple(12f, 12f, 3f)),
    )

@Composable
fun ArrowUpIcon(modifier: Modifier = Modifier, size: Dp = 18.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M12 19V5.5M5.5 11.5 12 5l6.5 6.5"), modifier, size, color)

@Composable
fun BackIcon(modifier: Modifier = Modifier, size: Dp = 16.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M14.5 5.5 8 12l6.5 6.5"), modifier, size, color)

@Composable
fun SparkIcon(modifier: Modifier = Modifier, size: Dp = 16.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M12 3c.6 3.9 2.1 5.4 6 6-3.9.6-5.4 2.1-6 6-.6-3.9-2.1-5.4-6-6 3.9-.6 5.4-2.1 6-6Z"), modifier, size, color)

@Composable
fun StarIcon(modifier: Modifier = Modifier, size: Dp = 16.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("m12 3.2 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3.1-5.4 3.1 1.2-6L3.3 9.5l6.1-.7L12 3.2Z"), modifier, size, color)

@Composable
fun BookmarkIcon(modifier: Modifier = Modifier, size: Dp = 16.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M7 3.5h10a1 1 0 0 1 1 1v15.2a.5.5 0 0 1-.8.4L12 16.3l-5.2 3.8a.5.5 0 0 1-.8-.4V4.5a1 1 0 0 1 1-1Z"), modifier, size, color)

@Composable
fun CapIcon(modifier: Modifier = Modifier, size: Dp = 16.dp, color: Color = Color.Unspecified) =
    StrokeIcon(
        listOf("m2.5 9.5 9.5-4.5 9.5 4.5-9.5 4.5-9.5-4.5Z", "M6.5 11.5v4.2c0 1.3 2.5 2.8 5.5 2.8s5.5-1.5 5.5-2.8v-4.2M21.5 9.5v5"),
        modifier, size, color,
    )

@Composable
fun DumbbellIcon(modifier: Modifier = Modifier, size: Dp = 16.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M7 7.5v9M4.5 9.5v5M17 7.5v9M19.5 9.5v5M7 12h10"), modifier, size, color)

@Composable
fun BriefcaseIcon(modifier: Modifier = Modifier, size: Dp = 16.dp, color: Color = Color.Unspecified) =
    StrokeIcon(
        listOf("M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M4 12.5h16"),
        modifier, size, color,
        rects = listOf(RectStroke(4f, 7.5f, 16f, 12f, 2.5f)),
    )

@Composable
fun RepeatIcon(modifier: Modifier = Modifier, size: Dp = 12.dp, color: Color = Color.Unspecified) =
    StrokeIcon(
        listOf("M17 2.5 20 5.5l-3 3", "M4 11.5v-1a5 5 0 0 1 5-5h11", "M7 21.5 4 18.5l3-3", "M20 12.5v1a5 5 0 0 1-5 5H4"),
        modifier, size, color,
    )

@Composable
fun BellIcon(modifier: Modifier = Modifier, size: Dp = 20.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z", "M10 20.5a2.2 2.2 0 0 0 4 0"), modifier, size, color)

@Composable
fun PersonIcon(modifier: Modifier = Modifier, size: Dp = 20.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M5.5 19.5a6.5 6.5 0 0 1 13 0"), modifier, size, color, circles = listOf(Triple(12f, 8.5f, 3.5f)))

@Composable
fun UsersIcon(modifier: Modifier = Modifier, size: Dp = 20.dp, color: Color = Color.Unspecified) =
    StrokeIcon(
        listOf("M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.6c1.6.6 2.6 2 3 4.4"),
        modifier, size, color,
        circles = listOf(Triple(9f, 8.5f, 3.2f)),
    )

@Composable
fun BrainIcon(modifier: Modifier = Modifier, size: Dp = 20.dp, color: Color = Color.Unspecified) =
    StrokeIcon(
        listOf(
            "M9 4.5a3 3 0 0 0-3 3v.2A3 3 0 0 0 4.5 13a3 3 0 0 0 1.8 4.6A3 3 0 0 0 12 18.5v-11a3 3 0 0 0-3-3ZM15 4.5a3 3 0 0 1 3 3v.2a3 3 0 0 1 1.5 5.3 3 3 0 0 1-1.8 4.6A3 3 0 0 1 12 18.5",
            "M12 7.5a3 3 0 0 1 3-3",
        ),
        modifier, size, color,
    )

@Composable
fun KeyIcon(modifier: Modifier = Modifier, size: Dp = 20.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("m10.5 12.5 8-8M15.5 7.5l2 2M17.5 5.5l2 2"), modifier, size, color, circles = listOf(Triple(8f, 15f, 3.5f)))

@Composable
fun VideoIcon(modifier: Modifier = Modifier, size: Dp = 12.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("m15.5 10.5 5-3v9l-5-3"), modifier, size, color, rects = listOf(RectStroke(3.5f, 6.5f, 12f, 11f, 2.5f)))

@Composable
fun LockIcon(modifier: Modifier = Modifier, size: Dp = 20.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"), modifier, size, color, rects = listOf(RectStroke(5.5f, 10.5f, 13f, 9.5f, 2.5f)))

@Composable
fun FlameIcon(modifier: Modifier = Modifier, size: Dp = 16.dp, color: Color = Color.Unspecified) =
    StrokeIcon(listOf("M12 20.5a6 6 0 0 0 6-6c0-3.5-2.5-5.5-3.5-8.5-1.5 2-2 3.5-2.5 5-1-1-1.5-2-1.5-3.5C8 9.5 6 12 6 14.5a6 6 0 0 0 6 6Z"), modifier, size, color)

/** Значок вида события: как `BADGE_ICON` на сайте. */
@Composable
fun BadgeIcon(badge: String, modifier: Modifier = Modifier, size: Dp = 10.dp, color: Color = Color.Unspecified) = when (badge) {
    "sleep" -> MoonIcon(modifier, size, color)
    "work" -> BriefcaseIcon(modifier, size, color)
    "food" -> StarIcon(modifier, size, color)
    "sport" -> DumbbellIcon(modifier, size, color)
    "read" -> BookmarkIcon(modifier, size, color)
    else -> SparkIcon(modifier, size, color)
}
