package app.calendar.ui

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
            ) { Text("◐", fontSize = 26.sp, color = Color.White) }
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
                Field(username, { username = it }, "Логин")
                if (register) Field(name, { name = it }, "Имя")
                Field(password, { password = it }, "Пароль", password = true)
                ErrorBanner(controller.error, onDismiss = controller::dismissError)
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(52.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(if (username.isNotBlank() && password.isNotBlank()) Color(0xFFF3F3F6) else Color(0xFF3A3A44))
                        .clickable(enabled = username.isNotBlank() && password.isNotBlank() && !controller.loading) {
                            controller.login(username, password, register, name)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(if (register) "Создать аккаунт" else "Войти", color = Color(0xFF0D0D10), fontWeight = FontWeight.Medium)
                }
            }
        }
    }
}

@Composable
private fun ModeTab(label: String, on: Boolean, modifier: Modifier, click: () -> Unit) {
    Box(
        modifier
            .height(38.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(if (on) MaterialTheme.colorScheme.surface else Color.Transparent)
            .clickable(onClick = click),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (on) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, placeholder: String, password: Boolean = false) {
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        textStyle = androidx.compose.ui.text.TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 16.sp),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
        modifier = Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
        decorationBox = { inner ->
            Box(Modifier.padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) Text(placeholder, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 16.sp)
                inner()
            }
        },
    )
}
