package app.calendar.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable

@Composable
actual fun platformInDarkTheme(): Boolean = isSystemInDarkTheme()
