package app.calendar.ui

import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendar.CalendarController

@Composable
fun AuthScreen(controller: CalendarController) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var register by rememberSaveable { mutableStateOf(false) }
    var showServer by rememberSaveable { mutableStateOf(false) }
    val ready = username.isNotBlank() && password.isNotBlank() && !controller.loading
    val submit = { if (ready) controller.login(username, password, register, name) }
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
        Column(
            Modifier
                .padding(horizontal = 24.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(32.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(start = 26.dp, end = 26.dp, top = 34.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(18.dp))
                    .background(Color(0xFF2A2A36))
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) { InfinityIcon(size = 28.dp, color = Color.White) }
            Text("Календарь", modifier = Modifier.padding(top = 16.dp), fontSize = 30.sp, fontWeight = FontWeight.SemiBold)
            Text(
                if (register) "Аккаунт для задач и совместной работы" else "Войдите, чтобы продолжить",
                modifier = Modifier.padding(top = 6.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 14.sp,
            )
            Row(
                Modifier
                    .padding(top = 20.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(999.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(4.dp),
            ) {
                ModeTab("Вход", !register, Modifier.weight(1f)) { register = false }
                ModeTab("Регистрация", register, Modifier.weight(1f)) { register = true }
            }
            Column(Modifier.padding(top = 16.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Field(username, { username = it }, "Логин", ime = ImeAction.Next, type = KeyboardType.Ascii, capitalization = KeyboardCapitalization.None)
                if (register) Field(name, { name = it }, "Имя", ime = ImeAction.Next, capitalization = KeyboardCapitalization.Words)
                Field(password, { password = it }, "Пароль", password = true, ime = ImeAction.Done, type = KeyboardType.Password, onDone = submit)
                if (showServer) {
                    Field(
                        controller.serverUrl,
                        { controller.serverUrl = it },
                        "Адрес сервера",
                        ime = ImeAction.Done,
                        type = KeyboardType.Uri,
                        capitalization = KeyboardCapitalization.None,
                        onDone = controller::checkServer,
                    )
                }
                Text(
                    if (showServer) "Скрыть адрес сервера" else "Сервер: ${controller.serverUrl}",
                    modifier = Modifier.pressable(role = Role.Button) { showServer = !showServer }
                        .align(Alignment.CenterHorizontally)
                        .defaultMinSize(minHeight = 44.dp)
                        .padding(horizontal = 8.dp, vertical = 12.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp,
                )
                ErrorBanner(controller.error, onDismiss = controller::dismissError)
                Box(
                    Modifier.pressable(enabled = ready, role = Role.Button) { submit() }
                        .fillMaxWidth()
                        .height(52.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(if (ready) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (controller.loading) "Секунду…" else if (register) "Создать аккаунт" else "Войти",
                        color = if (ready) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }
}

@Composable
private fun ModeTab(label: String, on: Boolean, modifier: Modifier, click: () -> Unit) {
    Box(
        modifier.pressable(role = Role.Tab, onClick = click)
            .height(38.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(if (on) MaterialTheme.colorScheme.surface else Color.Transparent),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (on) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
    }
}

@Composable
private fun Field(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    password: Boolean = false,
    ime: ImeAction = ImeAction.Next,
    type: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    onDone: (() -> Unit)? = null,
) {
    var shown by remember { mutableStateOf(false) }
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        keyboardOptions = KeyboardOptions(
            capitalization = capitalization,
            autoCorrectEnabled = false,
            keyboardType = type,
            imeAction = ime,
        ),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
        visualTransformation = if (password && !shown) PasswordVisualTransformation() else VisualTransformation.None,
        textStyle = androidx.compose.ui.text.TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 16.sp, fontFamily = LocalInter.current),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
        modifier = Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
        decorationBox = { inner ->
            Row(Modifier.padding(start = 16.dp, end = if (password) 2.dp else 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) Text(placeholder, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 16.sp)
                    inner()
                }
                if (password) PasswordEye(shown, { shown = !shown })
            }
        },
    )
}
