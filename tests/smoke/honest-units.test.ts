import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unitsForUsd, UNIT_COST_USD } from '@/lib/generations-config'
import { usageToUsd } from '@/lib/billing/chatPricing'

// Честные единицы (мандат Матвея 05.09): чат списывает по себестоимости ответа,
// пользователь видит только единицы (наша цена — тайна), оценка до отправки
// считается по тем же блокам, что уходят в модель.
const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')

describe('честные единицы', () => {
  it('единица = $0.065 себестоимости, округление вверх шагом 0,5, минимум 0,5', () => {
    expect(UNIT_COST_USD).toBe(0.065)
    expect(unitsForUsd(0)).toBe(0.5)
    expect(unitsForUsd(0.03)).toBe(0.5)
    expect(unitsForUsd(0.065)).toBe(1)
    expect(unitsForUsd(0.10)).toBe(2)     // 1.54 → 2 (шаг 0,5 вверх)
    expect(unitsForUsd(0.50)).toBe(8)     // сообщение Даши до фикса кэша = 8 ед.
    expect(unitsForUsd(0.15)).toBe(2.5)   // после фикса кэша
  })

  it('себестоимость по usage считается той же формулой, что кап и usage-report', () => {
    // 100k чтения из кэша + 2k записи 1h + 1.6k выхода на opus: 0.05 + 0.02 + 0.04
    const usd = usageToUsd({ cache_read_input_tokens: 100_000, cache_creation: { ephemeral_1h_input_tokens: 2_000 }, output_tokens: 1_600 })
    expect(usd).toBeCloseTo(0.05 + 0.02 + 0.04, 3)
  })

  it('чат: оценка ДО без списания, списание ПО ФАКТУ после стрима, обе ветки', () => {
    const route = read('app/api/ai/chat/route.ts')
    expect(route).not.toContain("gateMicroAction(user.id, 'chat'")
    expect(route).toContain('chatEstimate = await estimateChatUnits(')
    expect(route).toContain('stats.remaining < need')
    expect((route.match(/chargeChatByUsage\(user\.id, usages/g) || []).length).toBe(2)
    // генерация: фикс «пост = 2 ед.» вперёд, доплата только превышения
    expect(route).toContain("minUnitsAlreadyCharged: UNIT_COSTS.content")
  })

  it('оценка и боевой ответ строят контекст ОДНИМ модулем', () => {
    expect(read('app/api/ai/chat/estimate/route.ts')).toContain('buildProjectChatContext')
    expect(read('app/api/ai/chat/route.ts')).toContain('buildProjectChatContext')
    expect(read('lib/ai/chatContext.ts')).toContain('export async function buildProjectChatContext')
  })

  it('наружу не уходит себестоимость: estimate и сводка отдают только единицы', () => {
    const est = read('app/api/ai/chat/estimate/route.ts')
    expect(est).not.toMatch(/usd:/)
    const card = read('components/billing/UsageCard.tsx')
    expect(card).not.toContain('Ресурс AI на месяц')
    expect(card).not.toMatch(/\busd\b/i)
    expect(card).not.toMatch(/\$\s?\d/)
  })

  it('оба чата показывают «≈ N ед. · осталось M» и последнее списание', () => {
    for (const p of ['app/(dashboard)/create/page.tsx', 'app/(dashboard)/projects/[id]/assistant/page.tsx']) {
      const src = read(p)
      expect(src, p).toContain('/api/ai/chat/estimate')
      expect(src, p).toContain('Следующее сообщение ≈')
      expect(src, p).toContain('Списано')
    }
  })
})

describe('списание живёт до закрытия стрима (serverless засыпает после ответа)', () => {
  it('onUsage вызывается ДО controller.close() в обеих ветках', () => {
    const src = read('app/api/ai/chat/route.ts')
    const okBranch = src.slice(src.indexOf("result: { text: acc, complete: true }"), src.indexOf("controller.close()", src.indexOf("result: { text: acc, complete: true }")))
    expect(okBranch).toContain('await onUsage(usages)')
    const cutBranch = src.slice(src.indexOf('Ответ прервался'), src.indexOf('already closed', src.indexOf('Ответ прервался')))
    expect(cutBranch).toContain('await onUsage(usages)')
  })
})
