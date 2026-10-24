package app.calendar

import app.calendar.api.Task
import app.calendar.domain.titleSuggestions
import kotlin.test.Test
import kotlin.test.assertEquals

class TaskTitlesTest {
    private val tasks = listOf("Купить молоко", "Позвонить маме", "Молоко для кота", "купить молоко")
        .mapIndexed { i, title -> Task(id = "$i", title = title, done = i == 1) }

    @Test
    fun startsGoFirstAndDuplicatesAreDropped() {
        assertEquals(listOf("Молоко для кота", "Купить молоко"), titleSuggestions(tasks, "мол"))
        assertEquals(listOf("Купить молоко"), titleSuggestions(tasks, "куп"))
    }

    @Test
    fun doneTasksAreSuggestedToo() {
        assertEquals(listOf("Позвонить маме"), titleSuggestions(tasks, "позв"))
    }

    @Test
    fun exactMatchAndBlankGiveNothing() {
        assertEquals(emptyList(), titleSuggestions(tasks, "Позвонить маме"))
        assertEquals(emptyList(), titleSuggestions(tasks, "  "))
    }

    @Test
    fun limitIsRespected() {
        val many = (1..5).map { Task(id = "$it", title = "а$it") }
        assertEquals(4, titleSuggestions(many, "а").size)
        assertEquals(2, titleSuggestions(many, "а", 2).size)
    }
}
