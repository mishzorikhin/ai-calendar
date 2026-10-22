const rules = new Intl.PluralRules('ru-RU')

/** Формы слова для 1, 2–4 и 5+ («событие», «события», «событий»). */
export type PluralForms = readonly [one: string, few: string, many: string]

export function plural(n: number, [one, few, many]: PluralForms): string {
  const rule = rules.select(n)
  if (rule === 'one') return one
  if (rule === 'few') return few
  return many
}

/** «3 события». */
export function pluralize(n: number, forms: PluralForms): string {
  return `${n} ${plural(n, forms)}`
}

/** «только что», «5 минут назад», «3 часа назад», «вчера», «4 дня назад» — когда это было относительно now. */
export function agoLabel(at: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000))
  if (minutes < 2) return 'только что'
  if (minutes < 60) return `${pluralize(minutes, ['минуту', 'минуты', 'минут'])} назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${pluralize(hours, ['час', 'часа', 'часов'])} назад`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'вчера' : `${pluralize(days, ['день', 'дня', 'дней'])} назад`
}
