package app.calendar.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.calendar.CalendarController
import app.calendar.domain.isoDate

@Composable
fun TasksScreen(controller: CalendarController) {
    var title by rememberSaveable { mutableStateOf("") }
    val today = isoDate(controller.today())
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Задачи", style = MaterialTheme.typography.headlineLarge)
        OutlinedTextField(
            value = title,
            onValueChange = { title = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Новая задача") },
            singleLine = true,
        )
        PrimaryButton("Добавить", enabled = title.isNotBlank() && !controller.loading) {
            controller.addTask(title)
            title = ""
        }
        if (controller.tasks.isEmpty() && !controller.loading) {
            Text("Пока пусто.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        controller.tasks.forEach { task ->
            val habitOn = task.kind == "habit" && today in task.checks
            val mark = when {
                task.kind == "habit" && habitOn -> "●"
                task.kind == "habit" -> "○"
                task.done -> "✓"
                else -> "○"
            }
            val kind = when (task.kind) {
                "goal" -> "цель"
                "habit" -> "привычка"
                else -> "задача"
            }
            Row(
                modifier = Modifier.fillMaxWidth().clickable { controller.toggleTask(task) }.padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(mark, modifier = Modifier.padding(end = 12.dp), style = MaterialTheme.typography.titleMedium)
                Column(Modifier.weight(1f)) {
                    Text(
                        task.title,
                        color = if (task.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    )
                    val extra = listOfNotNull(kind, task.due.takeIf { it.isNotBlank() }?.let { "до $it" }).joinToString(" · ")
                    Text(extra, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}
