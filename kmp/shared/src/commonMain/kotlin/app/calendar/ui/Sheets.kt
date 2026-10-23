package app.calendar.ui

import app.calendar.api.NewTask
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
    val heightFraction = if (chrome == SheetChrome.Modal) 0.92f else 0.88f
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
            enter = slideInVertically(tween(280)) { it },
            exit = slideOutVertically(tween(200)) { it },
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            var drag by remember { mutableFloatStateOf(0f) }
            Surface(
                modifier = Modifier
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
                    val scrollMax = maxHeight - 26.dp
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
                                        val close = drag > 140f || velocity > 1400f
                                        drag = 0f
                                        if (close) onClose()
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
                        Column(
                            Modifier
                                .heightIn(max = scrollMax)
                                .verticalScroll(scroll)
                                .then(bodyModifier),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            content()
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
private val cadences = listOf("daily" to "Каждый день", "weekdays" to "По будням", "weekly" to "Раз в неделю")

@Composable
fun TaskForm(onClose: () -> Unit, onSave: (NewTask) -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("task") }
    var estimate by rememberSaveable { mutableStateOf(0) }
    var category by rememberSaveable { mutableStateOf("") }
    var customTag by rememberSaveable { mutableStateOf("") }
    var cadence by rememberSaveable { mutableStateOf("daily") }
    var due by rememberSaveable { mutableStateOf("") }
    var guests by rememberSaveable { mutableStateOf("") }
    val dueValid = due.isBlank() || Regex("""\d{4}-\d{2}-\d{2}""").matches(due.trim())
    val ready = title.isNotBlank() && dueValid
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            "Новая задача",
            modifier = Modifier.weight(1f),
            fontSize = 24.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Box(
            Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Закрыть", onClick = onClose),
            contentAlignment = Alignment.Center,
        ) { CloseIcon(size = 18.dp, color = MaterialTheme.colorScheme.onSurface) }
    }
    SheetField(title, { title = it }, "Что нужно сделать?")
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
        SheetField(due, { due = it }, "Срок, ГГГГ-ММ-ДД — необязательно")
        if (!dueValid) Text("Дата в виде 2026-12-31", color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
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
            ChoicePill(label, category == id && customTag.isBlank()) {
                customTag = ""
                category = if (category == id) "" else id
            }
        }
    }
    SheetField(customTag, { customTag = it.take(30) }, "Или свой тег…")
    Text("Вместе с кем-то", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
    SheetField(guests, { guests = it }, "@логин — поделиться задачей")
    Text("Подсказка: @логин прямо в названии тоже поделится задачей", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
    Box(
        Modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(if (ready) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
            .clickable(enabled = ready, role = Role.Button) {
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
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "Создать задачу",
            color = if (ready) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
fun SheetField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    onDone: (() -> Unit)? = null,
    password: Boolean = false,
) {
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = if (password) {
            KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Password, imeAction = ImeAction.Done)
        } else {
            KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done)
        },
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
        textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 17.sp),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
        modifier = Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
        decorationBox = { inner ->
            Box(Modifier.padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) Text(placeholder, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 17.sp)
                inner()
            }
        },
    )
}

@Composable
fun ChoicePill(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
            .clickable(role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
        fontSize = 14.sp,
    )
}

@Composable
fun ChoiceRow(focusIndex: Int = 0, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    // Примерно по ширине плашки: выбранное значение не прячется за краем.
    val initial = with(density) { (focusIndex.coerceAtLeast(0) * 76).dp.roundToPx() }
    Row(Modifier.horizontalScroll(rememberScrollState(initial)), horizontalArrangement = Arrangement.spacedBy(8.dp)) { content() }
}
