package app.calendar.ui

import androidx.compose.material3.ProvideTextStyle
import org.jetbrains.compose.resources.Font
import app.calendar.resources.inter_bold
import app.calendar.resources.inter_semibold
import app.calendar.resources.inter_medium
import app.calendar.resources.inter_regular
import app.calendar.resources.Res
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape

private val Ink = Color(0xFF0D0D10)
private val InkSoft = Color(0xFF6B6B73)
private val Paper = Color(0xFFF3F2F5)
private val Blue = Color(0xFF3A78F2)

private val LightColors = lightColorScheme(
    primary = Color(0xFF0F0F12),
    onPrimary = Color.White,
    secondary = Blue,
    onSecondary = Color.White,
    background = Paper,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = Color(0xFFF4F4F6),
    onSurfaceVariant = InkSoft,
    error = Color(0xFFB42318),
    outline = Color(0x140F0F1E),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFF0EFF4),
    onPrimary = Color(0xFF0D0D10),
    secondary = Color(0xFF5A8FF5),
    onSecondary = Color(0xFF0D0D10),
    background = Color(0xFF0C0C10),
    onBackground = Color(0xFFF3F3F6),
    surface = Color(0xFF19191F),
    onSurface = Color(0xFFF3F3F6),
    surfaceVariant = Color(0xFF222229),
    onSurfaceVariant = Color(0xFFA7A7B1),
    error = Color(0xFFFF8F85),
    outline = Color(0x14FFFFFF),
)

private val CalendarShapes = Shapes(
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(22.dp),
    large = RoundedCornerShape(32.dp),
)

private val CalendarType = Typography(
    headlineLarge = TextStyle(fontSize = 34.sp, lineHeight = 38.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.6).sp),
    headlineSmall = TextStyle(fontSize = 22.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
)

@Composable
expect fun systemInDarkTheme(): Boolean

/** Выбор темы в настройках: `null` — как в системе. */
val LocalThemeOverride = compositionLocalOf<Boolean?> { null }

/** Тёмная ли тема сейчас: выбор пользователя сильнее системной. */
@Composable
fun platformInDarkTheme(): Boolean = LocalThemeOverride.current ?: systemInDarkTheme()

@Composable
fun CalendarTheme(themeMode: String = "system", content: @Composable () -> Unit) {
    val override = when (themeMode) {
        "dark" -> true
        "light" -> false
        else -> null
    }
    CompositionLocalProvider(LocalThemeOverride provides override) { ThemedContent(content) }
}

/** Шрифт приложения (Inter) для полей ввода: `BasicTextField` не берёт семейство из темы. */
val LocalInter = staticCompositionLocalOf<FontFamily> { FontFamily.Default }

/** Inter из ресурсов приложения: 400, 500, 600 и 700 — кириллица и латиница. */
@Composable
private fun interFamily(): FontFamily = FontFamily(
    Font(Res.font.inter_regular, FontWeight.Normal),
    Font(Res.font.inter_medium, FontWeight.Medium),
    Font(Res.font.inter_semibold, FontWeight.SemiBold),
    Font(Res.font.inter_bold, FontWeight.Bold),
)

private fun Typography.withFamily(family: FontFamily) = Typography(
    displayLarge = displayLarge.copy(fontFamily = family),
    displayMedium = displayMedium.copy(fontFamily = family),
    displaySmall = displaySmall.copy(fontFamily = family),
    headlineLarge = headlineLarge.copy(fontFamily = family),
    headlineMedium = headlineMedium.copy(fontFamily = family),
    headlineSmall = headlineSmall.copy(fontFamily = family),
    titleLarge = titleLarge.copy(fontFamily = family),
    titleMedium = titleMedium.copy(fontFamily = family),
    titleSmall = titleSmall.copy(fontFamily = family),
    bodyLarge = bodyLarge.copy(fontFamily = family),
    bodyMedium = bodyMedium.copy(fontFamily = family),
    bodySmall = bodySmall.copy(fontFamily = family),
    labelLarge = labelLarge.copy(fontFamily = family),
    labelMedium = labelMedium.copy(fontFamily = family),
    labelSmall = labelSmall.copy(fontFamily = family),
)

@Composable
private fun ThemedContent(content: @Composable () -> Unit) {
    val dark = platformInDarkTheme()
    val family = interFamily()
    val typography = remember(family) { CalendarType.withFamily(family) }
    CompositionLocalProvider(LocalInter provides family) {
        MaterialTheme(
            colorScheme = if (dark) DarkColors else LightColors,
            shapes = CalendarShapes,
            typography = typography,
        ) {
            CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onBackground) {
                ApplySystemBars()
                // Текст без явного стиля (Text("…", fontSize = …)) тоже набирается Inter.
                ProvideTextStyle(TextStyle(fontFamily = family)) { content() }
            }
        }
    }
}

fun badgeColor(badge: String): Color = when (badge) {
    "sleep" -> Color(0xFF7F8A9B)
    "routine" -> Color(0xFF9B7AF0)
    "work" -> Color(0xFF3A78F2)
    "food" -> Color(0xFFF08B3D)
    "sport" -> Color(0xFF4CC46D)
    "read" -> Color(0xFFF5C445)
    else -> Color(0xFF8B8B95)
}

fun barColors(dark: Boolean): List<Color> = if (dark) {
    listOf(Color(0xFF3B2629), Color(0xFF3A2733), Color(0xFF30283D), Color(0xFF262A45))
} else {
    listOf(Color(0xFFF6C4BD), Color(0xFFF1D0D6), Color(0xFFE3D6EC), Color(0xFFCDD2F3))
}

/** Выходные в сетках и полосках: красный с запасом контраста в обеих темах. */
fun weekendColor(dark: Boolean): Color = if (dark) Color(0xFFFF7A80) else Color(0xFFD13A40)

fun barInk(dark: Boolean): Color = if (dark) Color(0xFFF0E1F0) else Color(0xFF372841)

/** --scrim из global.css */
fun sheetScrim(dark: Boolean): Color = if (dark) Color(0x8C000000) else Color(0x4D140F1E)

/** --handle */
fun sheetHandle(dark: Boolean): Color = if (dark) Color(0xFF4A4A54) else Color(0xFFDCDCE2)

/** --ink-soft для столбиков недели */
fun inkSoft(dark: Boolean): Color = if (dark) Color(0xFF8B8B95) else Color(0xFF85858D)

/** --line */
fun lineColor(dark: Boolean): Color = if (dark) Color(0x14FFFFFF) else Color(0x0F0F0F1E)
