import { describe, expect, it } from 'vitest'
import { titleSuggestions } from './taskTitles'
import type { Task } from './types'

const task = (title: string, done = false): Task => ({ id: title, title, subtitle: '', kind: 'task', done }) as Task

describe('titleSuggestions', () => {
  const tasks = [task('Купить молоко'), task('Позвонить маме', true), task('Молоко для кота'), task('купить молоко')]

  it('начало названия идёт раньше вхождения, повторы без учёта регистра убираются', () => {
    expect(titleSuggestions(tasks, 'мол')).toEqual(['Молоко для кота', 'Купить молоко'])
    expect(titleSuggestions(tasks, 'куп')).toEqual(['Купить молоко'])
  })

  it('найденное среди выполненных тоже подсказывается', () => {
    expect(titleSuggestions(tasks, 'позв')).toEqual(['Позвонить маме'])
  })

  it('точное совпадение и пустой ввод ничего не дают', () => {
    expect(titleSuggestions(tasks, 'Позвонить маме')).toEqual([])
    expect(titleSuggestions(tasks, '  ')).toEqual([])
  })

  it('ограничивает число подсказок', () => {
    const many = ['а1', 'а2', 'а3', 'а4', 'а5'].map((t) => task(t))
    expect(titleSuggestions(many, 'а')).toHaveLength(4)
    expect(titleSuggestions(many, 'а', 2)).toHaveLength(2)
  })
})
