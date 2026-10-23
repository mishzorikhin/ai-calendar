package app.calendar.ui

import android.app.UiModeManager
import android.content.res.Configuration
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext

@Composable
actual fun platformInDarkTheme(): Boolean {
    if (isSystemInDarkTheme()) return true
    val config = LocalConfiguration.current
    val fromConfig = config.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    val manager = LocalContext.current.getSystemService(UiModeManager::class.java)
    // На части прошивок ночной режим есть в системе, но в configuration.uiMode не попадает.
    val fromSystem = manager?.nightMode == UiModeManager.MODE_NIGHT_YES
    return fromConfig || fromSystem
}
