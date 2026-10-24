package app.calendar

import app.calendar.domain.MdBlock
import app.calendar.domain.MdSpan
import app.calendar.domain.parseInline
import app.calendar.domain.parseMarkdown
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class MarkdownTest {
    @Test
    fun boldItalicAndCode() {
        assertEquals(
            listOf(
                MdSpan("Встреча "),
                MdSpan("завтра", bold = true),
                MdSpan(" в "),
                MdSpan("10:00", italic = true),
                MdSpan(" "),
                MdSpan("ok", code = true),
            ),
            parseInline("Встреча **завтра** в *10:00* `ok`"),
        )
    }

    @Test
    fun unclosedBoldWhileStreamingStaysBold() {
        assertEquals(listOf(MdSpan("Готово: "), MdSpan("поставил", bold = true)), parseInline("Готово: **поставил"))
    }

    @Test
    fun loneAsteriskStaysLiteral() {
        assertEquals(listOf(MdSpan("2 * 3 = 6")), parseInline("2 * 3 = 6"))
    }

    @Test
    fun listsHeadingsAndParagraphs() {
        val blocks = parseMarkdown("## План\n\n- Планёрка в 10:00\n- Обед\n\n1. Позвонить\n2) Написать\nПросто строка")
        assertIs<MdBlock.Heading>(blocks[0])
        assertEquals(2, (blocks[0] as MdBlock.Heading).level)
        assertEquals(listOf("•", "•", "1.", "2."), blocks.filterIsInstance<MdBlock.Item>().map { it.marker })
        assertIs<MdBlock.Paragraph>(blocks.last())
    }

    @Test
    fun softLineBreaksStayInsideParagraph() {
        val blocks = parseMarkdown("Первая строка\nвторая строка")
        assertEquals(1, blocks.size)
        assertEquals("Первая строка\nвторая строка", (blocks[0] as MdBlock.Paragraph).spans.single().text)
    }
}
