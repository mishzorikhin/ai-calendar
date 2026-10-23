package app.calendar

import app.calendar.ui.softSpring
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.scaleOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.CubicBezierEasing
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
import app.calendar.ui.DiscardPrompt
import app.calendar.ui.ToastHost
import app.calendar.ui.LoadingBar
import app.calendar.ui.OfflineBadge
import kotlinx.coroutines.delay
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
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
import app.calendar.ui.ChatBar
import app.calendar.ui.ChatScreen
import app.calendar.ui.DayModeSwitch
import app.calendar.ui.DayScreen
import app.calendar.ui.ErrorBanner
import app.calendar.ui.AccountSheet
import app.calendar.ui.CalendarsSheet
import app.calendar.ui.PeopleSheet
import app.calendar.ui.RemindersSheet
import app.calendar.ui.ProfileSheet
import app.calendar.ui.EventEditor
import app.calendar.ui.EventSheet
import app.calendar.ui.MemoriesSheet
import app.calendar.ui.SearchSheet
import app.calendar.ui.SecuritySheet
import app.calendar.ui.TaskSheet
import app.calendar.ui.HomeScreen
import app.calendar.ui.MonthScreen
import app.calendar.ui.SheetChrome
import app.calendar.ui.WeekSheet

@Composable
fun App() {
    val scope = rememberCoroutineScope()
    val controller = remember { CalendarController(scope) }
    CalendarTheme(controller.themeMode) {
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

/** Глубина экрана: Главная → Месяц и Чат → День. */
private fun depth(screen: Screen): Int = when (screen) {
    Screen.Home -> 0
    Screen.Month, Screen.Chat -> 1
    is Screen.Day -> 2
}

private fun isForward(from: Screen, to: Screen): Boolean = when {
    from is Screen.Day && to is Screen.Day -> to.date >= from.date
    else -> depth(to) >= depth(from)
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun Shell(controller: CalendarController) {
    val screen = controller.screen
    val density = LocalDensity.current
    val sheetOpen = controller.weekSheet || controller.taskSheet || controller.composerDate != null ||
        controller.openedEvent != null || controller.openedTask != null || controller.searchSheet ||
        controller.accountSheet || controller.memorySheet || controller.calendarsSheet ||
        controller.profileSheet || controller.peopleSheet || controller.securitySheet || controller.remindersSheet
    LaunchedEffect(screen, controller.monthCursor) {
        controller.load(screen)
    }
    // Вернулись в приложение — данные могли устареть: обновляем текущий экран.
    val focused = LocalWindowInfo.current.isWindowFocused
    var wasAway by remember { mutableStateOf(false) }
    LaunchedEffect(focused) {
        if (!focused) {
            wasAway = true
        } else if (wasAway) {
            wasAway = false
            controller.load(screen)
            controller.sync()
        }
    }
    // Повтор неотправленного раз в полминуты, как на сайте: сеть могла вернуться без события.
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            controller.sync()
        }
    }
    // Системная «Назад»: сначала шторки, потом экран, и только с главной приложение закрывается.
    var exitArmed by remember { mutableStateOf(false) }
    LaunchedEffect(exitArmed) {
        if (exitArmed) {
            delay(2_000)
            exitArmed = false
        }
    }
    // На главной первое «Назад» только предупреждает; второе в течение двух секунд выходит из приложения.
    BackHandler(enabled = sheetOpen || screen != Screen.Home || !exitArmed) {
        when {
            controller.discardAction != null -> controller.keepEditing()
            controller.composerDate != null -> controller.closeForm { controller.composerDate = null }
            controller.openedEvent != null -> controller.openedEvent = null
            controller.openedTask != null -> controller.openedTask = null
            controller.searchSheet -> controller.closeSearch()
            controller.remindersSheet -> controller.remindersSheet = false
            controller.securitySheet -> controller.securitySheet = false
            controller.memorySheet -> controller.memorySheet = false
            controller.calendarsSheet -> controller.calendarsSheet = false
            controller.profileSheet -> controller.profileSheet = false
            controller.peopleSheet -> controller.peopleSheet = false
            controller.accountSheet -> controller.accountSheet = false
            controller.taskSheet -> controller.closeForm { controller.taskSheet = false }
            controller.weekSheet -> controller.weekSheet = false
            screen is Screen.Day -> controller.back()
            screen != Screen.Home -> controller.open(Screen.Home)
            else -> {
                exitArmed = true
                controller.showToast("Нажмите «Назад» ещё раз, чтобы выйти")
            }
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
                LoadingBar(controller.loading || controller.refreshing)
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { OfflineBadge(controller.offline, controller.pending) }
                ErrorBanner(
                    if (sheetOpen) null else controller.error,
                    onDismiss = controller::dismissError,
                    onRetry = controller.errorRetry?.let { retry -> { controller.dismissError(); retry() } },
                )
                AnimatedContent(
                    targetState = screen,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    // Смена дня лентой недели — тот же экран: плашка и слои не пересоздаются, а плавно переезжают.
                    contentKey = { if (it is Screen.Day) "day" else it },
                    transitionSpec = {
                        // Вперёд — «погружение», назад — «всплытие», как screenVariants на сайте.
                        val forward = isForward(initialState, targetState)
                        val rise = with(density) { (if (forward) 28.dp else (-10).dp).roundToPx() }
                        val sink = with(density) { (if (forward) (-8).dp else 24.dp).roundToPx() }
                        (
                            fadeIn(softSpring()) +
                                scaleIn(softSpring(), initialScale = if (forward) 0.94f else 1.04f) +
                                slideInVertically(softSpring()) { rise }
                            ).togetherWith(
                            fadeOut(tween(280, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f))) +
                                scaleOut(tween(280, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)), targetScale = if (forward) 1.03f else 0.95f) +
                                slideOutVertically(tween(280, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f))) { sink },
                        ).apply { targetContentZIndex = 2f }
                    },
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
            if (!sheetOpen && screen is Screen.Chat) {
                ChatBar(controller, modifier = Modifier.navigationBarsPadding())
            } else if (!sheetOpen) {
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
        AppSheet(visible = composing != null, onClose = { controller.closeForm { controller.composerDate = null } }) {
            Text(
                "Новое событие",
                fontSize = 24.sp,
                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            // Пока шторка уезжает, редактор остаётся на экране с тем же днём.
            var shownDate by remember { mutableStateOf(controller.today()) }
            if (composing != null) shownDate = composing
            run {
                EventEditor(
                    defaultStart = controller.composerStart,
                    date = shownDate,
                    today = controller.today(),
                    nowMinutes = controller.nowMinutes(),
                    eventsFor = controller::eventsKnownFor,
                    onDirtyChange = { controller.formDirty = it },
                    onDelegate = { request ->
                        controller.formDirty = false
                        controller.composerDate = null
                        controller.chatDraft = request
                        controller.open(Screen.Chat)
                    },
                ) { title, start, end, badge, allDay, notes, extras, day ->
                    if (!controller.loading) {
                        controller.createEvent(day, title, start, end, badge, allDay, notes, extras) {
                            controller.formDirty = false
                            controller.composerDate = null
                            controller.open(Screen.Day(day))
                        }
                    }
                }
            }
        }
        AppSheet(visible = controller.taskSheet, onClose = { controller.closeForm { controller.taskSheet = false } }) {
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            TaskForm(
                onClose = { controller.closeForm { controller.taskSheet = false } },
                onDirtyChange = { controller.formDirty = it },
                onSave = { controller.formDirty = false; controller.addTask(it) },
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
        AppSheet(visible = controller.securitySheet, onClose = { controller.securitySheet = false }, chrome = SheetChrome.Modal) {
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            SecuritySheet(controller)
        }
        AppSheet(visible = controller.remindersSheet, onClose = { controller.remindersSheet = false }, chrome = SheetChrome.Modal) {
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            RemindersSheet(controller)
        }
        AppSheet(visible = controller.calendarsSheet, onClose = { controller.calendarsSheet = false }, chrome = SheetChrome.Modal) {
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            CalendarsSheet(controller)
        }
        AppSheet(visible = controller.profileSheet, onClose = { controller.profileSheet = false }, chrome = SheetChrome.Modal) {
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            ProfileSheet(controller)
        }
        AppSheet(visible = controller.peopleSheet, onClose = { controller.peopleSheet = false }, chrome = SheetChrome.Modal) {
            ErrorBanner(controller.error, onDismiss = controller::dismissError)
            PeopleSheet(controller)
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
        ToastHost(
            controller.toast,
            onDismiss = controller::dismissToast,
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = if (sheetOpen) 24.dp else 92.dp),
        )
        DiscardPrompt(controller.discardAction != null, onDiscard = controller::confirmDiscard, onKeep = controller::keepEditing)
    }
}
