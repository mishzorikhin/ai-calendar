package app.calendar

import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.draw.clip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import app.calendar.ui.ActionBar
import app.calendar.ui.AppSheet
import app.calendar.ui.AuthScreen
import app.calendar.ui.CalendarTheme
import app.calendar.ui.TaskForm
import app.calendar.ui.barColors
import app.calendar.ui.platformInDarkTheme
import app.calendar.ui.ChatScreen
import app.calendar.ui.DayModeSwitch
import app.calendar.ui.DayScreen
import app.calendar.ui.ErrorBanner
import app.calendar.ui.AccountSheet
import app.calendar.ui.EventEditor
import app.calendar.ui.EventSheet
import app.calendar.ui.MemoriesSheet
import app.calendar.ui.SearchSheet
import app.calendar.ui.TaskSheet
import app.calendar.ui.HomeScreen
import app.calendar.ui.MonthScreen
import app.calendar.ui.SheetChrome
import app.calendar.ui.WeekSheet

@Composable
fun App() {
    val scope = rememberCoroutineScope()
    val controller = remember { CalendarController(scope) }
    CalendarTheme {
        val bar = Brush.horizontalGradient(barColors(platformInDarkTheme()))
        Box(
            modifier = Modifier.fillMaxSize().background(bar),
            contentAlignment = Alignment.TopCenter,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxHeight()
                    .widthIn(max = 480.dp)
                    .fillMaxWidth()
                    .imePadding(),
            ) {
                when {
                    controller.booting -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Открываю…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    controller.user == null -> AuthScreen(controller)
                    else -> Shell(controller)
                }
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun Shell(controller: CalendarController) {
    val screen = controller.screen
    val sheetOpen = controller.weekSheet || controller.taskSheet || controller.composerDate != null ||
        controller.openedEvent != null || controller.openedTask != null || controller.searchSheet ||
        controller.accountSheet || controller.memorySheet
    LaunchedEffect(screen, controller.monthCursor) {
        controller.load(screen)
    }
    // Системная «Назад»: сначала шторки, потом экран, и только с главной приложение закрывается.
    BackHandler(enabled = sheetOpen || screen != Screen.Home) {
        when {
            controller.composerDate != null -> controller.composerDate = null
            controller.openedEvent != null -> controller.openedEvent = null
            controller.openedTask != null -> controller.openedTask = null
            controller.searchSheet -> controller.closeSearch()
            controller.memorySheet -> controller.memorySheet = false
            controller.accountSheet -> controller.accountSheet = false
            controller.taskSheet -> controller.taskSheet = false
            controller.weekSheet -> controller.weekSheet = false
            screen is Screen.Day -> controller.back()
            else -> controller.open(Screen.Home)
        }
    }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // Лист как на сайте: фон до строки состояния, низ скруглён на 40px и открывает градиент панели.
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(bottomStart = 40.dp, bottomEnd = 40.dp))
                    .background(MaterialTheme.colorScheme.background)
                    .statusBarsPadding(),
            ) {
                CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onBackground) {
                ErrorBanner(if (sheetOpen) null else controller.error, onDismiss = controller::dismissError)
                AnimatedContent(
                    targetState = screen,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    transitionSpec = { fadeIn() togetherWith fadeOut() },
                ) { current ->
                    when (current) {
                        Screen.Home -> HomeScreen(controller)
                        Screen.Month -> MonthScreen(controller)
                        Screen.Chat -> ChatScreen(controller)
                        is Screen.Day -> DayScreen(controller, current.date)
                    }
                }
                }
            }
            if (!sheetOpen) {
                ActionBar(
                    assistantActive = screen is Screen.Chat,
                    onAssistant = { controller.open(if (screen is Screen.Chat) Screen.Home else Screen.Chat) },
                    onSay = { if (screen !is Screen.Day) controller.open(Screen.Chat) },
                    onCreate = { controller.compose(if (screen is Screen.Day) screen.date else controller.today()) },
                    modifier = Modifier.navigationBarsPadding(),
                    center = if (screen is Screen.Day) {
                        { DayModeSwitch(controller.dayTimeline) { controller.dayTimeline = it } }
                    } else {
                        null
                    },
                )
            }
        }
        val composing = controller.composerDate
        AppSheet(visible = composing != null, onClose = { controller.composerDate = null }) {
            Text(
                "Новое событие",
                fontSize = 24.sp,
                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            EventEditor { title, start, end, badge, allDay, notes ->
                if (composing != null && !controller.loading) {
                    controller.createEvent(composing, title, start, end, badge, allDay, notes) {
                        controller.composerDate = null
                        controller.open(Screen.Day(composing))
                    }
                }
            }
        }
        AppSheet(visible = controller.taskSheet, onClose = { controller.taskSheet = false }) {
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            TaskForm(
                onClose = { controller.taskSheet = false },
                onSave = { title, note, kind -> controller.addTask(title, note, kind) },
            )
        }
        val openedEvent = controller.openedEvent
        AppSheet(visible = openedEvent != null, onClose = { controller.openedEvent = null }) {
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            if (openedEvent != null) EventSheet(controller, openedEvent)
        }
        val openedTask = controller.openedTask
        AppSheet(visible = openedTask != null, onClose = { controller.openedTask = null }) {
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            if (openedTask != null) TaskSheet(controller, openedTask)
        }
        AppSheet(visible = controller.searchSheet, onClose = controller::closeSearch, chrome = SheetChrome.Modal) {
            SearchSheet(controller)
        }
        AppSheet(visible = controller.accountSheet, onClose = { controller.accountSheet = false }, chrome = SheetChrome.Modal) {
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            AccountSheet(controller)
        }
        AppSheet(visible = controller.memorySheet, onClose = { controller.memorySheet = false }, chrome = SheetChrome.Modal) {
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            MemoriesSheet(controller)
        }
        AppSheet(
            visible = controller.weekSheet,
            onClose = { controller.weekSheet = false },
            chrome = SheetChrome.Modal,
        ) {
            WeekSheet(controller, onClose = { controller.weekSheet = false })
        }
    }
}
