package app.calendar.ui

import app.calendar.api.NewTask
import app.calendar.api.Task
import app.calendar.domain.titleSuggestions
import app.calendar.domain.parseLogins
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.size
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.Orientation
import kotlin.math.roundToInt
import androidx.compose.ui.unit.IntOffset
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.semantics.Role
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.animation.core.animate
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.geometry.Rect
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.foundation.layout.fillMaxHeight
import app.calendar.domain.isoDate
import app.calendar.domain.parseIsoDate
import app.calendar.domain.monthGenitive
import kotlin.time.Instant
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.toLocalDateTime
import kotlinx.datetime.plus
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.TimeZone
import kotlinx.datetime.LocalDate
import kotlinx.coroutines.delay
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.geometry.Offset
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Закреплённый низ шторки: форма кладёт сюда кнопку «Создать», и она не уезжает при прокрутке. */
internal val LocalSheetFooter = compositionLocalOf<MutableState<(@Composable () -> Unit)?>?> { null }

@Composable
fun SheetFooter(content: @Composable () -> Unit) {
    val holder = LocalSheetFooter.current ?: run {
        content()
        return
    }
    SideEffect { holder.value = content }
    DisposableEffect(holder) { onDispose { holder.value = null } }
}

/** Главная кнопка форм: чёрная пилюля, пока не заполнено — серая. */
@Composable
fun SheetButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    val haptics = rememberHaptics()
    Box(
        Modifier.pressable(enabled = enabled, role = Role.Button) {
                haptics.confirm()
                onClick()
            }
            .fillMaxWidth()
            .height(54.dp)
            .clip(CircleShape)
            .background(if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (enabled) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Medium,
        )
    }
}

enum class SheetChrome {
    /** Компактная шторка форм. */
    Form,
    /** Как BottomSheet на сайте: 34px сверху, до 92% высоты, прокрутка тела. */
    Modal,
}

/** Шторка снизу: затемнение и выезд, как BottomSheet на сайте. */
@Composable
fun AppSheet(
    visible: Boolean,
    onClose: () -> Unit,
    chrome: SheetChrome = SheetChrome.Form,
    content: @Composable () -> Unit,
) {
    val dark = platformInDarkTheme()
    val scrim = sheetScrim(dark)
    val handle = sheetHandle(dark)
    val topRadius = if (chrome == SheetChrome.Modal) 34.dp else 32.dp
    val heightFraction = if (chrome == SheetChrome.Modal) 0.92f else 0.93f
    val footer = remember { mutableStateOf<(@Composable () -> Unit)?>(null) }
    // Шторка закрывается — клавиатура уходит вместе с ней, а не отдельным движением после.
    val focusManager = LocalFocusManager.current
    LaunchedEffect(visible) {
        if (!visible) focusManager.clearFocus(force = true)
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val maxSheetHeight = maxHeight * heightFraction
        Box(Modifier.fillMaxSize()) {
        AnimatedVisibility(visible, enter = fadeIn(tween(180)), exit = fadeOut(tween(160))) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(scrim)
                    .clickable(interactionSource = null, indication = null, role = Role.Button, onClickLabel = "Закрыть", onClick = onClose),
            )
        }
        AnimatedVisibility(
            visible = visible,
            enter = slideInVertically(uiSpring()) { it },
            exit = slideOutVertically(tween(200)) { it },
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            var drag by remember { mutableFloatStateOf(0f) }
            val close by rememberUpdatedState(onClose)
            val haptics = rememberHaptics()
            val scope = rememberCoroutineScope()
            // Не дотянули до порога — шторка плавно возвращается; при закрытии смещение не трогаем, иначе она подпрыгнет.
            val settle: () -> Unit = {
                scope.launch { animate(drag, 0f, animationSpec = uiSpring()) { value, _ -> drag = value } }
            }
            var armed by remember { mutableStateOf(false) }
            LaunchedEffect(drag > 140f) {
                if (drag > 140f && !armed) haptics.threshold()
                armed = drag > 140f
            }
            // Свайп вниз за любое место: когда тело уже прокручено к началу, остаток жеста тянет саму шторку.
            val pullDown = remember {
                object : NestedScrollConnection {
                    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                        if (drag > 0f && available.y < 0f) {
                            val step = maxOf(available.y, -drag)
                            drag += step
                            return Offset(0f, step)
                        }
                        return Offset.Zero
                    }

                    override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                        if (available.y > 0f && source == NestedScrollSource.UserInput) {
                            drag += available.y
                            return Offset(0f, available.y)
                        }
                        return Offset.Zero
                    }

                    override suspend fun onPreFling(available: Velocity): Velocity {
                        if (drag <= 0f) return Velocity.Zero
                        val shouldClose = drag > 140f || available.y > 1400f
                        if (shouldClose) {
                            haptics.end()
                            close()
                        } else {
                            settle()
                        }
                        return available
                    }
                }
            }
            Surface(
                modifier = Modifier
                    .nestedScroll(pullDown)
                    .offset { IntOffset(0, drag.roundToInt()) }
                    .fillMaxWidth()
                    .heightIn(max = maxSheetHeight)
                    .imePadding()
                    .navigationBarsPadding(),
                shape = RoundedCornerShape(topStart = topRadius, topEnd = topRadius),
                color = MaterialTheme.colorScheme.surface,
                shadowElevation = if (chrome == SheetChrome.Modal) 12.dp else 4.dp,
            ) {
                CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
                BoxWithConstraints(Modifier.fillMaxWidth().heightIn(max = maxSheetHeight)) {
                    Column(Modifier.fillMaxWidth()) {
                        // Свайп вниз за ручку закрывает шторку (тело прокручивается своим жестом).
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(26.dp)
                                .draggable(
                                    orientation = Orientation.Vertical,
                                    state = rememberDraggableState { delta -> drag = (drag + delta).coerceAtLeast(0f) },
                                    onDragStopped = { velocity ->
                                        if (drag > 140f || velocity > 1400f) onClose() else settle()
                                    },
                                ),
                            contentAlignment = Alignment.TopCenter,
                        ) {
                            Box(
                                Modifier
                                    .padding(top = 8.dp)
                                    .width(38.dp)
                                    .height(5.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(handle),
                            )
                        }
                        val bodyModifier = when (chrome) {
                            SheetChrome.Modal -> Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)
                            SheetChrome.Form -> Modifier.padding(start = 20.dp, end = 20.dp, bottom = 16.dp)
                        }
                        val scroll = rememberScrollState()
                        // Прокрутка нужна и формам: с клавиатурой кнопка «Создать» иначе уезжает за край.
                        CompositionLocalProvider(LocalSheetFooter provides footer) {
                            Column(
                                Modifier
                                    .weight(1f, fill = false)
                                    .fadingEdges(vertical = true, size = 12.dp, start = scroll.canScrollBackward, end = scroll.canScrollForward)
                                    .verticalScroll(scroll)
                                    .then(bodyModifier),
                                verticalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                content()
                            }
                        }
                        footer.value?.let { pinned ->
                            Box(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 16.dp)) { pinned() }
                        }
                    }
                }
                }
            }
        }
        }
    }
}

private val estimates = listOf(15 to "15 мин", 30 to "30 мин", 60 to "1 ч", 120 to "2 ч", 240 to "4 ч")
private val tags = listOf("study" to "Учёба", "sport" to "Спорт", "work" to "Работа")

@Composable
internal fun TagIcon(id: String, color: Color, size: androidx.compose.ui.unit.Dp = 16.dp) = when (id) {
    "study" -> CapIcon(size = size, color = color)
    "sport" -> DumbbellIcon(size = size, color = color)
    "work" -> BriefcaseIcon(size = size, color = color)
    else -> BookmarkIcon(size = size, color = color)
}

/** Подпись тега: у пресетов своя, свой тег показывается как есть. */
internal fun tagLabel(category: String): String = tags.firstOrNull { it.first == category }?.second ?: category
private val cadences = listOf("daily" to "Каждый день", "weekdays" to "По будням", "weekly" to "Раз в неделю")

@Composable
fun TaskForm(
    onClose: () -> Unit,
    onDirtyChange: (Boolean) -> Unit = {},
    knownTasks: List<Task> = emptyList(),
    onSave: (NewTask) -> Unit,
) {
    var title by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("task") }
    var estimate by rememberSaveable { mutableStateOf(0) }
    var category by rememberSaveable { mutableStateOf("") }
    var customTag by rememberSaveable { mutableStateOf("") }
    var cadence by rememberSaveable { mutableStateOf("daily") }
    var due by rememberSaveable { mutableStateOf("") }
    var guests by rememberSaveable { mutableStateOf("") }
    val ready = title.isNotBlank()
    val dirty = title.isNotBlank() || note.isNotBlank() || customTag.isNotBlank() || guests.isNotBlank()
    LaunchedEffect(dirty) { onDirtyChange(dirty) }
    DisposableEffect(Unit) { onDispose { onDirtyChange(false) } }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            "Новая задача",
            modifier = Modifier.weight(1f),
            fontSize = 24.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Box(
            Modifier.pressable(role = Role.Button, onClickLabel = "Закрыть", onClick = onClose).size(44.dp).clip(CircleShape),
            contentAlignment = Alignment.Center,
        ) { CloseIcon(size = 18.dp, color = MaterialTheme.colorScheme.onSurface) }
    }
    SheetField(title, { title = it }, "Что нужно сделать?")
    // Новую задачу можно назвать как старую: подсказываем прежние названия.
    val suggestions = titleSuggestions(knownTasks, title)
    if (suggestions.isNotEmpty()) {
        ChoiceRow { suggestions.forEach { name -> ChoicePill(name, selected = false) { title = name } } }
    }
    SheetField(note, { note = it }, "Заметка — необязательно")
    Text("Вид", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("task" to "Задача", "goal" to "Цель", "habit" to "Привычка").forEach { (id, label) ->
            ChoicePill(label, kind == id) { kind = id }
        }
    }
    if (kind == "habit") {
        Text("Как часто", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        ChoiceRow { cadences.forEach { (id, label) -> ChoicePill(label, cadence == id) { cadence = id } } }
    }
    if (kind == "goal") {
        DueField(due) { due = it }
    }
    if (kind != "habit") {
        Text("Сколько займёт", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        ChoiceRow {
            estimates.forEach { (minutes, label) ->
                ChoicePill(label, estimate == minutes) { estimate = if (estimate == minutes) 0 else minutes }
            }
        }
    }
    Text("Тег", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
    ChoiceRow {
        tags.forEach { (id, label) ->
            ChoicePill(label, category == id && customTag.isBlank(), icon = { c -> TagIcon(id, c) }) {
                customTag = ""
                category = if (category == id) "" else id
            }
        }
    }
    SheetField(customTag, { customTag = it.take(30) }, "Или свой тег…")
    Text("Вместе с кем-то", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
    SheetField(guests, { guests = it }, "@логин — поделиться задачей", last = true)
    Text("Подсказка: @логин прямо в названии тоже поделится задачей", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
    SheetFooter {
        SheetButton("Создать задачу", ready) {
            onSave(
                NewTask(
                    title = title,
                    note = note,
                    kind = kind,
                    category = customTag.trim().ifBlank { category },
                    estimate = if (kind == "habit") 0 else estimate,
                    due = if (kind == "goal") due else "",
                    cadence = if (kind == "habit") cadence else "",
                    members = parseLogins(guests),
                ),
            )
        }
    }
}

/**
 * Поле шторки. [autoFocus] — сразу открыть клавиатуру (после выезда шторки), [last] — последнее поле формы:
 * на клавиатуре «Готово», а у остальных «Далее» переводит к следующему полю.
 */
@Composable
fun SheetField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    onDone: (() -> Unit)? = null,
    password: Boolean = false,
    autoFocus: Boolean = false,
    last: Boolean = false,
) {
    val focusManager = LocalFocusManager.current
    val requester = remember { FocusRequester() }
    if (autoFocus) {
        LaunchedEffect(Unit) {
            delay(380)
            runCatching { requester.requestFocus() }
        }
    }
    var shown by remember { mutableStateOf(false) }
    val finish = last || onDone != null || password
    val action = if (finish) ImeAction.Done else ImeAction.Next
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        visualTransformation = if (password && !shown) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = if (password) {
            KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Password, imeAction = action)
        } else {
            KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = action)
        },
        keyboardActions = KeyboardActions(
            onNext = { focusManager.moveFocus(FocusDirection.Next) },
            onDone = {
                if (onDone != null) onDone() else focusManager.clearFocus()
            },
        ),
        textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 17.sp, fontFamily = LocalInter.current),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .focusRequester(requester),
        decorationBox = { inner ->
            Row(Modifier.padding(start = 16.dp, end = if (password) 4.dp else 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) Text(placeholder, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 17.sp, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    inner()
                }
                if (password) PasswordEye(shown, { shown = !shown })
            }
        },
    )
}

/** Выбор даты системным календарём: на сайте это «Выбрать дату». */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DatePickerSheet(initial: LocalDate?, onPick: (LocalDate) -> Unit, onDismiss: () -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = initial?.atStartOfDayIn(TimeZone.UTC)?.toEpochMilliseconds())
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let { onPick(Instant.fromEpochMilliseconds(it).toLocalDateTime(TimeZone.UTC).date) }
                onDismiss()
            }) { Text("Готово") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Отмена") } },
    ) { DatePicker(state) }
}

/** День события: «Сегодня / Завтра / Послезавтра» и выбор любой даты. */
@Composable
fun DayChips(date: LocalDate, today: LocalDate, onChange: (LocalDate) -> Unit) {
    var picker by remember { mutableStateOf(false) }
    val haptics = rememberHaptics()
    val quick = listOf(0 to "Сегодня", 1 to "Завтра", 2 to "Послезавтра")
    val custom = quick.none { today.plus(DatePeriod(days = it.first)) == date }
    Text("День", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
    ChoiceRow {
        quick.forEach { (offset, label) ->
            val day = today.plus(DatePeriod(days = offset))
            ChoicePill(label, day == date) { onChange(day) }
        }
        ChoicePill(
            if (custom) "${date.dayOfMonth} ${monthGenitive(date)}" else "Выбрать дату",
            custom,
            icon = { c -> CalendarIcon(size = 14.dp, color = c) },
        ) {
            haptics.tick()
            picker = true
        }
    }
    if (picker) DatePickerSheet(date, onPick = onChange, onDismiss = { picker = false })
}

/** Срок задачи: кнопка с датой и «✕», без ручного ввода «ГГГГ-ММ-ДД». */
@Composable
fun DueField(due: String, onChange: (String) -> Unit) {
    var picker by remember { mutableStateOf(false) }
    val parsed = runCatching { parseIsoDate(due) }.getOrNull()
    Row(
        Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f).fillMaxHeight().pressable(role = Role.Button, onClickLabel = "Выбрать срок") { picker = true }.padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            CalendarIcon(size = 16.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                if (parsed == null) "Срок — необязательно" else "К ${parsed.dayOfMonth} ${monthGenitive(parsed)}",
                color = if (parsed == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                fontSize = 17.sp,
            )
        }
        if (parsed != null) {
            Box(
                Modifier.pressable(role = Role.Button, onClickLabel = "Убрать срок") { onChange("") }.size(54.dp),
                contentAlignment = Alignment.Center,
            ) { CloseIcon(size = 16.dp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
    if (picker) DatePickerSheet(parsed, onPick = { onChange(isoDate(it)) }, onDismiss = { picker = false })
}

/** [reveal] — при появлении прокрутить ряд так, чтобы вариант был виден с запасом по краям. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChoicePill(label: String, selected: Boolean, icon: (@Composable (Color) -> Unit)? = null, reveal: Boolean = false, onClick: () -> Unit) {
    val requester = remember { BringIntoViewRequester() }
    var size by remember { mutableStateOf(IntSize.Zero) }
    if (reveal) {
        LaunchedEffect(size) {
            if (size.width > 0) {
                requester.bringIntoView(Rect(-size.width * 1.5f, 0f, size.width * 2.5f, size.height.toFloat()))
            }
        }
    }
    val ink = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    Row(
        Modifier.bringIntoViewRequester(requester).onSizeChanged { size = it }
            .pressable(role = Role.RadioButton, onClick = onClick)
            .clip(RoundedCornerShape(999.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        icon?.invoke(ink)
        Text(label, color = ink, fontSize = 14.sp, maxLines = 1, softWrap = false)
    }
}

@Composable
fun ChoiceRow(content: @Composable () -> Unit) {
    val scroll = rememberScrollState()
    Row(
        Modifier
            .fadingEdges(vertical = false, size = 22.dp, start = scroll.canScrollBackward, end = scroll.canScrollForward)
            .horizontalScroll(scroll),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) { content() }
}
