export const DEMO_PROMPT = 'Запланируй завтрак со мной и моим другом Глебом завтра утром'

export type ChatCategoryId = 'food' | 'travel' | 'activity' | 'work'

export type ChatCategory = { id: ChatCategoryId; label: string; prompts: readonly string[] }

export const CHAT_CATEGORIES: readonly ChatCategory[] = [
  {
    id: 'food',
    label: 'Еда',
    prompts: [DEMO_PROMPT, 'Запланируй ужин на четверых в пятницу', 'Напомни пообедать в обед'],
  },
  { id: 'travel', label: 'Путешествия', prompts: ['Спланируй отпуск в Париже', 'Найди время на выходные для поездки'] },
  { id: 'activity', label: 'Активности', prompts: ['Запланируй тренировку на завтра', 'Найди время для пробежки'] },
  { id: 'work', label: 'Работа', prompts: ['Запланируй встречу с командой', 'Освободи утро в четверг'] },
]

export const QUICK_PROMPTS = [
  { label: 'Запланировать завтрак', prompt: DEMO_PROMPT },
  { label: 'Запланировать встречу', prompt: 'Запланируй встречу с командой на завтра' },
  { label: 'Найти время вечером', prompt: 'Найди свободное время вечером на чтение' },
] as const
