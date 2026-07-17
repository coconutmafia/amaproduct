import { describe, it, expect } from 'vitest'
import { auditToText } from '@/lib/blogAudit/auditToText'
import { CHECKLIST } from '@/lib/blogAudit/checklist'
import type { AuditResult } from '@/lib/blogAudit/runBlogAudit'

const result: AuditResult = {
  handle: 'anette_eyn',
  diagnosis: 'Страница рабочая, но есть потери в доверии/CTA/контенте',
  summary: 'Блог обаятельный, но структура не выстроена на продажу.',
  topGaps: ['Нет соцдоказательств: опыт, ученики, регалии', 'Не описан результат для ученика'],
  scored: 46,
  assessableMax: 74,
  score100: 62,
  score10: 6.2,
  notAssessableCount: 13,
  blocks: [
    {
      key: 'audience', title: 'ЦА и смыслы', scored: 7, assessableMax: 10,
      items: [
        { label: 'Понятно ли, для какой конкретной аудитории блог?', assessable: true, score: 2, note: 'Да — девушки, dancehall, Новосибирск' },
        { label: 'Видно ли, какие боли аудитории закрывает блог?', assessable: true, score: 1, note: 'Частично — боли намёками' },
      ],
    },
    {
      key: 'highlights', title: 'Актуальные', scored: 0, assessableMax: 0,
      items: [
        { label: 'Есть ли актуальное «Обо мне / мой путь»?', assessable: false, score: null, note: 'Не видно из профиля — разберём на консультации' },
      ],
    },
  ],
}

describe('auditToText — выгрузка разбора в документ', () => {
  const text = auditToText(result, '17 июля 2026')

  it('содержит хендл, дату и диагноз', () => {
    expect(text).toContain('@anette_eyn')
    expect(text).toContain('17 июля 2026')
    expect(text).toContain('Страница рабочая')
  })

  it('раскладывает 100 баллов на три зоны и они сходятся в 100', () => {
    // green=46, grey=100-74=26, yellow=74-46=28 → 46+26+28 = 100
    expect(text).toContain('46 — уже сделано')
    expect(text).toContain('26 — не проверить автоматически')
    expect(text).toContain('28 — можно усилить')
  })

  it('пункты идут как ВОПРОС → ОТВЕТ (главное требование владельца)', () => {
    expect(text).toContain('Понятно ли, для какой конкретной аудитории блог?')
    expect(text).toContain('Да — девушки, dancehall, Новосибирск')
    // ответ идёт следующей строкой под вопросом
    const lines = text.split('\n')
    const qi = lines.findIndex(l => l.includes('Видно ли, какие боли'))
    expect(lines[qi + 1]).toContain('Частично — боли намёками')
  })

  it('блок без машинной оценки помечен «на консультации», а не нулём', () => {
    expect(text).toContain('Актуальные — на консультации')
    expect(text).not.toContain('Актуальные — 0 из 0')
  })

  it('включает вердикт и что усилить', () => {
    expect(text).toContain('Блог обаятельный')
    expect(text).toContain('1. Нет соцдоказательств')
  })
})

describe('чек-лист — все пункты сформулированы вопросами', () => {
  it('каждый label заканчивается знаком вопроса', () => {
    const bad = CHECKLIST.flatMap(b => b.items.filter(i => !i.label.trim().endsWith('?')).map(i => i.label))
    expect(bad).toEqual([])
  })

  it('чек-лист остался 10×5 = 50 пунктов (100 баллов)', () => {
    expect(CHECKLIST).toHaveLength(10)
    expect(CHECKLIST.every(b => b.items.length === 5)).toBe(true)
  })
})
