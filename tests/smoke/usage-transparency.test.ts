import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { friendlyError } from '@/lib/friendlyError'

// «Тариф и расход» (мандат Матвея 04.09): Даша упёрлась в лимит при 29/300
// единиц — её закрыл невидимый второй ограничитель (ресурс AI). Стражи:
// обе шкалы показаны, тексты не врут про «все единицы», буст капа живёт
// и до миграции 044 (best-effort), инструмент «открыть на N дней» есть.
const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')

describe('прозрачность лимитов', () => {
  it('сводка расхода: единицы + ресурс AI + разбивка + «на что хватит» из UNIT_COSTS', () => {
    const src = read('lib/billing/usageSummary.ts')
    expect(src).toContain('generations_used')
    expect(src).toContain('tierBudgetUsd(tier)')
    expect(src).toContain('sharePct')
    expect(src).toContain('UNIT_COSTS.content')
    expect(src, 'цены в сводке — только из UNIT_COSTS').not.toMatch(/units: \d+, per/)
  })

  it('карточка стоит в настройках, на главной и в окне лимита', () => {
    expect(read('components/settings/SettingsClient.tsx')).toContain('<UsageCard />')
    expect(read('app/(dashboard)/dashboard/page.tsx')).toContain('<UsageCard compact />')
    const dlg = read('components/billing/UpgradeDialog.tsx')
    expect(dlg).toContain("reason === 'limit' || reason === 'budget'")
    expect(dlg).toContain("budget:     { title: 'Ресурс AI на этот месяц исчерпан'")
    expect(dlg, 'host уточняет причину по факту').toContain("setReason('budget')")
  })

  it('тексты не врут про «все единицы», когда закрыл ресурс AI', () => {
    const out = friendlyError(new Error('limit_reached'))
    expect(out).not.toContain('Единицы контента на этот месяц закончились')
    expect(out).toContain('Тариф и расход')
  })

  it('буст капа: best-effort до миграции 044, гаснет по дате', () => {
    const cap = read('lib/billing/costCap.ts')
    expect(cap).toContain('export async function activeBoostUsd')
    expect(cap).toContain('until > Date.now()')
    expect(cap, 'кап суммирует буст').toContain('+ await activeBoostUsd(admin, userId)')
    const sql = read('supabase/migrations/044_budget_boost.sql')
    expect(sql).toContain('budget_boost_until')
    expect(read('scripts/prod-probe.mjs')).toContain("'grant-boost': grantBoost")
  })
})

describe('лента списаний — каждая задача фиксируется (миграция 045)', () => {
  it('гейты и возвраты пишут в unit_ledger, best-effort', () => {
    const gen = read('lib/generations.ts')
    expect((gen.match(/recordUnits\(/g) || []).length).toBe(4)
    expect(gen).toContain("if (res.allowed) void recordUnits(userId, action, 1)")
    const micro = read('lib/ai/usage.ts')
    expect(micro).toContain('recordUnits(userId, route, microUnits(route, batch))')
    expect(read('supabase/migrations/045_unit_ledger.sql')).toContain('unit_ledger_owner_read')
  })

  it('каждый вызов gateContentUnit(s) в роутах подписан действием', () => {
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const out = execSync("grep -rn 'gateContentUnits\\?(' app --include='*.ts' | grep -v 'export async function'", { cwd: process.cwd() }).toString()
    const unlabeled = out.split('\n').filter(l => l.trim()).filter(l => /gateContentUnit\(user\.id\)|gateContentUnits\(user\.id, [^,)]+\)/.test(l))
    expect(unlabeled, `без подписи действия:\n${unlabeled.join('\n')}`).toEqual([])
  })

  it('лента показана в карточке и приходит в сводке', () => {
    expect(read('components/billing/UsageCard.tsx')).toContain('Последние списания')
    expect(read('lib/billing/usageSummary.ts')).toContain('recentLedger(userId, 30)')
  })
})
