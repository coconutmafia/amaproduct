import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { FACTCHECK_MARKER, FACTCHECK_STATUS, splitFactcheck, streamingDisplay, finalAnswer, factcheckPrompt } from '@/lib/chat/factcheck'
import { factcheckEstimateUsd } from '@/lib/billing/chatPricing'

// Проверочный проход (A/B №4 07.09: 12:0, выдумок 1 против 27). Стражи:
// протокол маркера, подмена черновика проверенным текстом, защита от «сдутой»
// проверки, обе страницы чата и роут на одном модуле, оценка знает о проверке.
const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')
const draft = 'Черновик ответа. '.repeat(30)

describe('факт-чек: протокол стрима', () => {
  it('без маркера — черновик как есть', () => {
    expect(splitFactcheck(draft)).toEqual({ draft, checked: null })
    expect(streamingDisplay(draft)).toBe(draft)
    expect(finalAnswer(draft)).toBe(draft)
  })
  it('после маркера показываем статус, в итоге — проверенный текст', () => {
    const checked = 'Проверенный ответ. '.repeat(25)
    const acc = draft + FACTCHECK_MARKER + checked
    expect(streamingDisplay(acc)).toBe(draft + FACTCHECK_STATUS)
    expect(finalAnswer(acc)).toBe(checked.trim())
  })
  it('проверка оборвалась/пустая → остаётся черновик', () => {
    expect(finalAnswer(draft + FACTCHECK_MARKER)).toBe(draft)
    expect(finalAnswer(draft + FACTCHECK_MARKER + 'Прове')).toBe(draft)
  })
  it('промпт проверки бьёт по трём типам выдумок и запрещает новые утверждения', () => {
    const p = factcheckPrompt('вопрос', 'черновик')
    expect(p).toMatch(/цитата не дословная/)
    expect(p).toMatch(/цифра, которой нет в материалах/)
    expect(p).toMatch(/не добавляй новых утверждений/)
    expect(p).toContain('=== ЧЕРНОВИК ===\nчерновик')
  })
})

describe('факт-чек: роут, страницы, оценка', () => {
  it('роут: проверка после черновика на тех же кэш-блоках, usage проверки списывается, ящик хранит итог', () => {
    const r = read('app/api/ai/chat/route.ts')
    const iDraft = r.indexOf("if (final?.stop_reason !== 'max_tokens') break")
    const iCheck = r.indexOf('safeSend(FACTCHECK_MARKER)')
    expect(iCheck).toBeGreaterThan(iDraft)
    expect(r).toContain('factcheckPrompt(factcheckQuestion, acc)')
    expect(r).toContain("usages.push((done as unknown as { usage: ChatUsage }).usage)")
    expect(r).toContain("result: { text: answer, complete: true }")
    expect(r).toContain("process.env.CHAT_FACTCHECK !== '0'")
    // режим без проекта — без проверки (нет материалов)
    expect(r).toContain('lastMessage, // факт-чек — только с материалами проекта')
  })
  it('обе страницы чата: статус во время стрима и finalAnswer при сохранении/восстановлении', () => {
    for (const p of ['app/(dashboard)/create/page.tsx', 'app/(dashboard)/projects/[id]/assistant/page.tsx']) {
      const s = read(p)
      expect(s, p).toContain('setStreaming(streamingDisplay(acc))')
      expect(s, p).toContain("content: finalAnswer(acc)")
      expect(s, p).toContain('finalAnswer(pending) + PENDING_CUT_NOTE')
      expect(s, p).not.toMatch(/content: acc \}/)
    }
  })
  it('оценка «≈ N ед.» включает проверку', () => {
    expect(factcheckEstimateUsd(80_000)).toBeGreaterThan(0.05)
    expect(factcheckEstimateUsd(80_000)).toBeLessThan(0.25)
    expect(read('app/api/ai/chat/route.ts')).toContain('factcheck: FACTCHECK_ENABLED }).catch')
  })
})

// 10.09: у Даши ответы на 22–32 тыс. знаков; клиент обрывал соединение, и
// enqueue в закрытый контроллер валил проверочный проход — «Invalid state:
// Controller is already closed» ×4 в журнале. В ящик уезжал ЧЕРНОВИК вместо
// проверенного текста, а обрыв клиента выглядел как поломка сервиса.
describe('обрыв клиента не ломает ответ и не шумит в журнале', () => {
  const src = readFileSync(`${process.cwd()}/app/api/ai/chat/route.ts`, 'utf8')
  it('в контроллер пишем только через safeSend, close — под защитой', () => {
    expect(src).toContain('const safeSend = (text: string) => {')
    expect(src).toContain('catch { clientGone = true }')
    expect(src).not.toMatch(/\n\s+controller\.enqueue\(/) // прямых enqueue не осталось
    expect(src).toContain('try { controller.close() } catch')
  })
  it('«Controller is already closed» не пишется в журнал как ошибка сервиса', () => {
    expect(src).toContain('Controller is already closed|closed stream')
    expect(src).toContain('if (!closed) await captureException(err, { where: \'chat stream\'')
  })
  it('ушёл клиент без ящика — проверку не запускаем (деньги впустую)', () => {
    expect(src).toContain('const factcheckWorthIt = !clientGone || !!genJobId')
    expect(src).toContain('factcheckQuestion && factcheckWorthIt')
  })
})
