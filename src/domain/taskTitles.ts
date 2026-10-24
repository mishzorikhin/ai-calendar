import type { Task } from './types'

/**
 * Подсказки названия новой задачи из прежних: те, что содержат введённое (без учёта регистра),
 * сначала начинающиеся с него. Повторы и точное совпадение с вводом не показываем.
 * Порядок внутри группы — как в списке задач.
 */
export function titleSuggestions(tasks: readonly Task[], query: string, limit = 4): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const seen = new Set<string>()
  const starts: string[] = []
  const inside: string[] = []
  for (const { title } of tasks) {
    const name = title.trim()
    const key = name.toLowerCase()
    if (!name || key === q || seen.has(key)) continue
    seen.add(key)
    if (key.startsWith(q)) starts.push(name)
    else if (key.includes(q)) inside.push(name)
  }
  return [...starts, ...inside].slice(0, limit)
}
