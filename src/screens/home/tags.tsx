import { BookmarkIcon, BriefcaseIcon, CapIcon, DumbbellIcon } from '../../components/Icons'

/** Пресеты тега задачи с иконками — подсказки, а не ограничение: тег может быть любым текстом. */
export const TAG_PRESETS = [
  { id: 'study', icon: CapIcon, label: 'Учёба' },
  { id: 'sport', icon: DumbbellIcon, label: 'Спорт' },
  { id: 'work', icon: BriefcaseIcon, label: 'Работа' },
] as const

export function tagLabel(category: string): string {
  return TAG_PRESETS.find((p) => p.id === category)?.label ?? category
}

/** Иконка тега: своя у пресетов, закладка — у пользовательских. */
export function tagIconEl(category: string, size = 14) {
  const Icon = TAG_PRESETS.find((p) => p.id === category)?.icon ?? BookmarkIcon
  return <Icon size={size} />
}
