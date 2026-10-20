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
