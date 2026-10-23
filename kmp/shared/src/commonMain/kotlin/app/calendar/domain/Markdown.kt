package app.calendar.domain

/**
 * Небольшой разбор markdown для ответов ассистента: абзацы, заголовки, списки, **жирный**, *курсив* и `код`.
 * Больше модель в чат почти ничего не шлёт; таблицы и ссылки показываются как есть.
 */
data class MdSpan(
    val text: String,
    val bold: Boolean = false,
    val italic: Boolean = false,
    val code: Boolean = false,
)

sealed interface MdBlock {
    data class Paragraph(val spans: List<MdSpan>) : MdBlock

    /** [level] — 1…3: чем меньше, тем крупнее. */
    data class Heading(val level: Int, val spans: List<MdSpan>) : MdBlock

    /** Пункт списка: [marker] — «•» или «1.». */
    data class Item(val marker: String, val spans: List<MdSpan>) : MdBlock
}

private val numbered = Regex("^(\\d{1,3})[.)]\\s+(.*)$")
private val heading = Regex("^(#{1,3})\\s+(.*)$")

fun parseMarkdown(text: String): List<MdBlock> {
    val blocks = mutableListOf<MdBlock>()
    val paragraph = mutableListOf<String>()
    fun flush() {
        if (paragraph.isNotEmpty()) {
            blocks += MdBlock.Paragraph(parseInline(paragraph.joinToString("\n")))
            paragraph.clear()
        }
    }
    for (raw in text.lines()) {
        val line = raw.trimEnd()
        val trimmed = line.trimStart()
        when {
            trimmed.isEmpty() -> flush()
            heading.matches(trimmed) -> {
                flush()
                val match = heading.matchEntire(trimmed)!!
                blocks += MdBlock.Heading(match.groupValues[1].length, parseInline(match.groupValues[2]))
            }
            trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ") -> {
                flush()
                blocks += MdBlock.Item("•", parseInline(trimmed.drop(2).trimStart()))
            }
            numbered.matches(trimmed) -> {
                flush()
                val match = numbered.matchEntire(trimmed)!!
                blocks += MdBlock.Item(match.groupValues[1] + ".", parseInline(match.groupValues[2]))
            }
            else -> paragraph += line
        }
    }
    flush()
    return blocks
}

/**
 * Строчная разметка. Незакрытый `**` считается жирным до конца: пока ответ печатается потоком, закрывающей пары ещё нет,
 * и звёздочки не должны мигать в тексте. Одиночный `*` без пары остаётся буквой.
 */
fun parseInline(text: String): List<MdSpan> {
    val spans = mutableListOf<MdSpan>()
    val buffer = StringBuilder()
    var bold = false
    var italic = false
    fun flush() {
        if (buffer.isNotEmpty()) {
            spans += MdSpan(buffer.toString(), bold = bold, italic = italic)
            buffer.clear()
        }
    }
    var i = 0
    while (i < text.length) {
        when {
            text.startsWith("**", i) -> {
                flush()
                bold = !bold
                i += 2
            }
            text[i] == '`' -> {
                val end = text.indexOf('`', i + 1)
                if (end < 0) {
                    buffer.append(text[i])
                    i++
                } else {
                    flush()
                    spans += MdSpan(text.substring(i + 1, end), code = true)
                    i = end + 1
                }
            }
            text[i] == '*' && (italic || (i + 1 < text.length && text[i + 1] != ' ' && text.indexOf('*', i + 1) > 0)) -> {
                flush()
                italic = !italic
                i++
            }
            else -> {
                buffer.append(text[i])
                i++
            }
        }
    }
    flush()
    return spans
}
