import { dayLabel } from '../domain/request'
import type { RequestParams, TranscriptLine } from '../domain/types'

export const DEMO_PROMPT = 'Запланируй завтрак в уютном ресторане рядом со мной с моим другом Глебом'

export type ChatCategoryId = 'food' | 'travel' | 'activity' | 'work'

export type ChatCategory = { id: ChatCategoryId; label: string; prompts: readonly string[] }

export const CHAT_CATEGORIES: readonly ChatCategory[] = [
  {
    id: 'food',
    label: 'Еда',
    prompts: [DEMO_PROMPT, 'Найди ресторан для ужина на четверых', 'Закажи столик на обед в пятницу'],
  },
  { id: 'travel', label: 'Путешествия', prompts: ['Спланируй отпуск в Париже', 'Найди билеты на выходные'] },
  { id: 'activity', label: 'Активности', prompts: ['Запланируй тренировку 3 раза в неделю', 'Найди корт для тенниса'] },
  { id: 'work', label: 'Работа', prompts: ['Запланируй встречу с командой', 'Освободи утро в четверг'] },
]

export const QUICK_PROMPTS = [
  { label: 'Запланировать завтрак', prompt: DEMO_PROMPT },
  { label: 'Запланировать встречу', prompt: 'Запланируй встречу с командой на завтра' },
  { label: 'Спланировать отпуск', prompt: 'Спланируй мой отпуск целиком' },
] as const

/** Секунда звонка, на которой бронь считается подтверждённой. */
export const TRANSCRIPT_DONE_AT = 12

const GUESTS_WORD = ['одного', 'двоих', 'троих', 'четверых', 'пятерых', 'шестерых', 'семерых', 'восьмерых']

/** Сценарий звонка в ресторан с учётом параметров запроса. */
export function transcriptFor(params: RequestParams, time: string): TranscriptLine[] {
  const day = dayLabel(params.dayOffset).toLowerCase()
  const guests = GUESTS_WORD[params.guests - 1] ?? `${params.guests} человек`
  return [
    { at: 1, who: 'ai', text: `Здравствуйте! Хочу забронировать столик на ${guests} ${day} на ${time}.` },
    { at: 4, who: 'place', text: `Доброе утро! Да, на ${time} есть столик у окна.` },
    { at: 7, who: 'ai', text: 'Отлично, подойдёт. Бронь на имя владельца телефона, пожалуйста.' },
    { at: 10, who: 'place', text: `Записала. Ждём вас в ${time}!` },
  ]
}
