import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { toArray, toRecord, toStringList, parseMaybeJson } from '@/lib/ai/toolInput'
import { normalizeTable } from '@/lib/research/table1'

// Класс «модель отдала вложенный массив JSON-строкой» (tool_use). Замер 06.09
// на реальном батче Стаси Кожемяко: 2 прогона из 3 — respondents строкой на
// 19–23 тыс. знаков; код читал это как «участников нет» → 9 джобов подряд в
// ошибку, единицы туда-сюда, «Анализирую часть 3 из 4» на сутки. Лечение
// жило семью локальными копиями toArray, а у самого дорогого вызова (table1)
// его не было. Стражи ниже держат ОДИН общий хелпер у всех потребителей.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
function collectTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name === 'node_modules' || name.startsWith('.')) continue; out.push(...collectTs(p)) }
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('lib/ai/toolInput — строка вместо структуры', () => {
  it('toArray: массив как есть, JSON-строка и ```json-обёртка — парсятся, мусор → []', () => {
    expect(toArray([1, 2])).toEqual([1, 2])
    expect(toArray('[{"a":1}]')).toEqual([{ a: 1 }])
    expect(toArray('```json\n[1,2]\n```')).toEqual([1, 2])
    expect(toArray('не json')).toEqual([])
    expect(toArray('{"a":1}')).toEqual([])
    expect(toArray(undefined)).toEqual([])
  })
  it('toRecord / toStringList', () => {
    expect(toRecord('{"x":1}')).toEqual({ x: 1 })
    expect(toRecord('[1]')).toBeNull()
    expect(toStringList('["а","б"]')).toEqual(['а', 'б'])
    expect(toStringList('одна цитата')).toEqual(['одна цитата'])
    expect(toStringList(['x', '', 3])).toEqual(['x', '3'])
    expect(parseMaybeJson(5)).toBe(5)
  })
})

describe('normalizeTable — таблица исследования из любой формы ответа', () => {
  const respondents = [{
    id: 'Участник 1', name: 'Ангелина', segment: '19 лет, Тараз',
    answers: [{ question: 'Расскажи о себе', block: 'other', full_answer: 'Мне 19', key_quotes: ['мне 19'], emotional_tone: 'нейтрально' }],
  }, {
    id: 'Участник 2', name: 'Олеся', segment: '',
    answers: '[{"question":"Что мешает","block":"barriers","full_answer":"Нет времени","key_quotes":"нет времени вообще"}]',
  }]

  it('respondents строкой (реальный кейс 06.09) → массив участников с ответами', () => {
    const t = normalizeTable({ respondents: JSON.stringify(respondents) })
    expect(t.respondents.map(r => r.name)).toEqual(['Ангелина', 'Олеся'])
    // вложенный answers-строкой и key_quotes одиночной строкой тоже приводятся
    expect(t.respondents[1].answers[0].block).toBe('barriers')
    expect(t.respondents[1].answers[0].key_quotes).toEqual(['нет времени вообще'])
  })
  it('родной массив проходит без изменений; неизвестный блок → other; пустые ответы отсекаются', () => {
    const t = normalizeTable({ respondents: [{ id: 'x', name: 'Я', answers: [{ question: 'В', block: 'странный', full_answer: 'О' }, { question: '', block: 'other', full_answer: '' }] }] })
    expect(t.respondents[0].answers).toHaveLength(1)
    expect(t.respondents[0].answers[0].block).toBe('other')
  })
  it('мусор → пустой список, а не исключение', () => {
    expect(normalizeTable('nope').respondents).toEqual([])
    expect(normalizeTable({ respondents: 'не json' }).respondents).toEqual([])
  })
})

describe('страж класса: один хелпер у всех потребителей tool_use', () => {
  const sources = [...collectTs(join(ROOT, 'app')), ...collectTs(join(ROOT, 'lib'))]
  it('локальных копий toArray больше нет', () => {
    const copies = sources.filter(p => !p.endsWith('lib/ai/toolInput.ts') && /(?:function toArray\(|const toArray = )/.test(readFileSync(p, 'utf8')))
    expect(copies.map(p => p.replace(ROOT + '/', ''))).toEqual([])
  })
  it('каждый файл, читающий tool_use, импортирует lib/ai/toolInput', () => {
    const consumers = sources.filter(p => readFileSync(p, 'utf8').includes("type === 'tool_use'"))
    expect(consumers.length).toBeGreaterThanOrEqual(10)
    const bare = consumers.filter(p => !readFileSync(p, 'utf8').includes("@/lib/ai/toolInput"))
    expect(bare.map(p => p.replace(ROOT + '/', ''))).toEqual([])
  })
  it('ядро table1 не отбраковывает батч по Array.isArray', () => {
    const src = read('lib/research/table1.ts')
    expect(src).toContain('normalizeTable(toolBlock.input)')
    expect(src).not.toContain("!Array.isArray(data?.respondents)")
  })
})
