import { describe, it, expect } from 'vitest'
import { Packer } from 'docx'
import { zoneBreakdown } from '@/lib/blogAudit/auditToText'
import { buildAuditDocx } from '@/lib/blogAudit/auditToDocx'
import { CHECKLIST } from '@/lib/blogAudit/checklist'
import type { AuditResult } from '@/lib/blogAudit/runBlogAudit'

// 27.08 выгрузка переехала с плоского текста на ОФОРМЛЕННЫЙ документ (владелец:
// «скачивается простынёй, сделай как на сайте»). Требования к содержанию те же,
// что были у текстовой версии, поэтому проверки сохранены — просто теперь они
// смотрят внутрь .docx, а не в строку.
async function docxParts() {
  const doc = await buildAuditDocx(result, '17 июля 2026', 'https://t.me/probe')
  const buf = await Packer.toBuffer(doc)
  const { unzipSync, strFromU8 } = await import('fflate')
  const files = unzipSync(new Uint8Array(buf))
  const xml = strFromU8(files['word/document.xml'])
  return {
    buf,
    xml,
    text: xml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' '),
    rels: strFromU8(files['word/_rels/document.xml.rels']),
  }
}

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

describe('выгрузка разбора в документ', () => {
  it('это валидный .docx, а не простыня текста: внутри карточки-таблицы', async () => {
    const { buf, xml } = await docxParts()
    expect(buf.subarray(0, 2).toString('latin1'), 'zip-сигнатура').toBe('PK')
    // Карточка = таблица из одной ячейки; их должно быть много (шапка, зоны,
    // вердикт, «что усилить», по карточке на блок, CTA).
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBeGreaterThan(4)
  })

  it('блоки идут В ДВЕ КОЛОНКИ, как на экране', async () => {
    const { xml } = await docxParts()
    // Сетка блоков: строка таблицы с ДВУМЯ ячейками по 50%.
    const twoCellRows = (xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [])
      .filter(r => (r.match(/<w:tc>/g) ?? []).length === 2)
    expect(twoCellRows.length, 'нет ни одной строки из двух карточек').toBeGreaterThan(0)
    expect(xml, 'колонки должны быть равными').toContain('50')
  })

  it('содержит хендл, дату и диагноз', async () => {
    const { text } = await docxParts()
    expect(text).toContain('@anette_eyn')
    expect(text).toContain('17 июля 2026')
    expect(text).toContain('Страница рабочая')
  })

  it('раскладывает 100 баллов на три зоны и они сходятся в 100', async () => {
    const { text } = await docxParts()
    // green=46, grey=100-74=26, yellow=74-46=28 → 46+26+28 = 100
    expect(text).toContain('46 — собрано')
    expect(text).toContain('26 — нужна оценка эксперта')
    expect(text).toContain('28 — зона роста')
  })

  it('полоса баллов нарисована цветами экрана, а не описана словами', async () => {
    const { xml } = await docxParts()
    expect(xml, 'нет зелёной части').toContain('22C55E')
    expect(xml, 'нет серой части').toContain('CBD5E1')
    expect(xml, 'нет янтарной части').toContain('F59E0B')
  })

  it('поясняет, что для ЭТОГО блога в каждой зоне (просьба Августы)', async () => {
    const { text } = await docxParts()
    // audience: 7/10 = 70% → собрано; highlights: нечего оценивать → нужен эксперт
    expect(text).toContain('Собрано: ЦА и смыслы')
    expect(text).toContain('Нужен эксперт: Актуальные')
  })

  it('пункты идут как ВОПРОС → ОТВЕТ (главное требование владельца)', async () => {
    const { text } = await docxParts()
    expect(text).toContain('Понятно ли, для какой конкретной аудитории блог?')
    // ответ идёт СРАЗУ за вопросом, а не где-то в документе
    expect(text).toContain('Видно ли, какие боли аудитории закрывает блог?Частично — боли намёками')
  })

  it('блок без машинной оценки помечен «на консультации», а не нулём', async () => {
    const { text } = await docxParts()
    expect(text).toContain('Актуальные')
    expect(text).toContain('на консультации')
    expect(text).not.toContain('0/0')
  })

  it('неоценённый пункт помечен замком, нулевой — красным маркером', async () => {
    const { xml, text } = await docxParts()
    expect(text, 'нет замка у пункта «на консультации»').toContain('🔒')
    expect(xml, 'нет янтарного маркера у пункта на 1 балл').toContain('F59E0B')
  })

  it('включает вердикт и что усилить', async () => {
    const { text } = await docxParts()
    expect(text).toContain('Блог обаятельный')
    expect(text).toContain('Что усилить в первую очередь')
    expect(text).toContain('Нет соцдоказательств')
  })

  it('ссылка на консультацию ведёт туда же, куда кнопка на экране', async () => {
    const { rels } = await docxParts()
    expect(rels).toContain('https://t.me/probe')
  })
})

describe('zoneBreakdown — какие блоки в какой зоне', () => {
  it('блок с половиной баллов и выше → «собрано», иначе → «зона роста»', () => {
    const z = zoneBreakdown(result)
    expect(z.green).toContain('ЦА и смыслы')   // 7/10 = 70%
    expect(z.yellow).not.toContain('ЦА и смыслы')
  })

  it('блок, который нечего оценивать машинно → «нужен эксперт», а не 0 баллов', () => {
    const z = zoneBreakdown(result)
    expect(z.grey).toEqual(['Актуальные'])
    expect(z.yellow).not.toContain('Актуальные')
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
