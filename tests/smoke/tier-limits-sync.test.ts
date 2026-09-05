import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_CONFIG } from '@/lib/generations-config'

// Смена тарифа (перевод клиентов на базовый, 25.08) опирается на то, что лимиты
// живут В ТРЁХ местах и обязаны совпадать: PLAN_CONFIG (код), generation_limit /
// project_limit (функции в БД — их читает consume_generation и триггер проектов)
// и зеркало LIMITS в пробнике limit-smoke. Разъедутся — гейт начнёт резать или
// пропускать не по тарифу, причём молча. Правка любого из мест без остальных —
// ровно класс «меняешь одно — меняй оба» из блока МОДЕЛЬ БИЛЛИНГА.

const ROOT = join(__dirname, '..', '..')

// Числа из CASE-веток plpgsql: WHEN 'tier' THEN N
function parseCaseLimits(sql: string, fnName: string): Record<string, number> {
  const fn = sql.split(new RegExp(`FUNCTION ${fnName}\\s*\\(`, 'i'))[1]
  expect(fn, `${fnName} не найдена в миграции`).toBeTruthy()
  const body = fn.split(/END;?\s*\$\$/i)[0]
  const out: Record<string, number> = {}
  for (const m of body.matchAll(/WHEN\s+'([a-z]+)'\s+THEN\s+(\d+)/gi)) out[m[1]] = Number(m[2])
  return out
}

describe('лимиты тарифов синхронны: БД ↔ PLAN_CONFIG ↔ пробник', () => {
  // 040 ПЕРЕОПРЕДЕЛЯЕТ обе функции (добавлен starter) — истина теперь там;
  // 016/035 остаются историей.
  it('generation_limit (миграция 046) == PLAN_CONFIG.generations', () => {
    // 046 переопределяет generation_limit (честные объёмы pro/producer 05.09)
    const sql = readFileSync(join(ROOT, 'supabase/migrations/046_honest_tier_limits.sql'), 'utf8')
    const db = parseCaseLimits(sql, 'generation_limit')
    for (const tier of ['trial', 'starter', 'solo', 'pro', 'producer'] as const) {
      expect(db[tier], `generation_limit('${tier}')`).toBe(PLAN_CONFIG[tier].generations)
    }
  })

  it('project_limit (миграция 040) == PLAN_CONFIG.projects', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/040_starter_tier.sql'), 'utf8')
    const db = parseCaseLimits(sql, 'project_limit')
    for (const tier of ['trial', 'starter', 'solo', 'pro', 'producer'] as const) {
      expect(db[tier], `project_limit('${tier}')`).toBe(PLAN_CONFIG[tier].projects)
    }
  })

  it('constraint 040 разрешает ровно тиры из PLAN_CONFIG', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/040_starter_tier.sql'), 'utf8')
    for (const tier of ['trial', 'starter', 'solo', 'pro', 'producer']) {
      expect(sql, `'${tier}' в constraint`).toContain(`'${tier}'`)
    }
  })

  it('зеркало LIMITS в prod-probe limit-smoke == PLAN_CONFIG.generations', () => {
    const probe = readFileSync(join(ROOT, 'scripts/prod-probe.mjs'), 'utf8')
    const m = probe.match(/const LIMITS = \{([^}]+)\}/)
    expect(m, 'const LIMITS не найден в prod-probe.mjs').toBeTruthy()
    const mirror: Record<string, number> = {}
    for (const pair of m![1].matchAll(/([a-z]+):\s*(\d+)/g)) mirror[pair[1]] = Number(pair[2])
    for (const tier of ['trial', 'solo', 'pro', 'producer'] as const) {
      expect(mirror[tier], `LIMITS.${tier} в пробнике`).toBe(PLAN_CONFIG[tier].generations)
    }
  })
})

// У гейта ДВЕ причины отказа с разными текстами для клиента: not_entitled →
// payment_required («подключи тариф»), quota → limit_reached («лимит исчерпан»).
// Неоплатившему нельзя показывать «ты создала все единицы» (враньё при 0), а
// упёршемуся в лимит — «подключи тариф» (он уже платит). Свип: КАЖДЫЙ роут,
// зовущий gateContentUnit(s), обязан ветвить оба кода — новый метереный роут
// с одним кодом на обе причины упадёт здесь, а не жалобой клиента.
describe('свип: каждый метереный роут различает payment_required / limit_reached', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === 'route.ts') files.push(p)
    }
  }
  walk(join(ROOT, 'app', 'api'))

  const metered = files.filter(f => /gateContentUnits?\(/.test(readFileSync(f, 'utf8')))

  it('метереные роуты найдены (не пустой свип)', () => {
    expect(metered.length).toBeGreaterThanOrEqual(4) // chat, plan-stories, montage, video-overlay…
  })

  for (const f of metered) {
    it(`ветвит оба кода: ${f.replace(ROOT, '')}`, () => {
      const src = readFileSync(f, 'utf8')
      expect(src, 'нет ветки payment_required').toMatch(/payment_required/)
      expect(src, 'нет ветки limit_reached').toMatch(/limit_reached/)
    })
  }
})
