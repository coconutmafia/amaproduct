import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fmtDateRu, fmtDateTimeRu } from '@/lib/dates'

// Регрессия 29–30 июля: React #418 на /projects у живого клиента. SSR идёт на
// Vercel в UTC, гидрация — в зоне браузера; toLocaleDateString без timeZone дал
// «29.07.2026» в SSR-HTML и «30.07.2026» на клиенте (updated_at попал в окно
// 21:00–24:00 UTC). Это ТРЕТИЙ инцидент класса «сервер и клиент форматируют
// по-разному» (16–17 июля дважды: toLocaleString без локали на /strategy и
// в проекте). Правило: даты/время форматируются ТОЛЬКО через lib/dates.ts
// (фиксированная зона Europe/Moscow) — сырые toLocale*String на Date запрещены.
describe('даты форматируются только через lib/dates (гидрация SSR-UTC vs клиент)', () => {
  const ROOTS = ['app', 'components', 'lib']
  const SKIP_DIRS = new Set(['node_modules', '.next'])
  // Единственное легальное место сырых вызовов — сам хелпер.
  const ALLOWED = new Set(['lib/dates.ts'])

  function walk(dir: string, acc: string[]): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(p, acc)
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
        acc.push(p)
      }
    }
    return acc
  }

  const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r), []))
    .map((p) => p.slice(process.cwd().length + 1))
    .filter((p) => !ALLOWED.has(p))

  // toLocaleDateString/toLocaleTimeString бывают только у Date — запрещены целиком.
  // toLocaleString есть и у Number (форматирование цен/чисел — легально),
  // поэтому для него ловим только явный вызов на Date. Обход через переменную
  // (const d = new Date(...); d.toLocaleString()) регекс не поймает — не пиши так.
  const BANNED: Array<[RegExp, string]> = [
    [/\.toLocaleDateString\(/, 'toLocaleDateString → fmtDateRu из lib/dates'],
    [/\.toLocaleTimeString\(/, 'toLocaleTimeString → fmtDateTimeRu из lib/dates'],
    [/new Date\([^)]*\)\s*\.toLocaleString\(/, 'new Date().toLocaleString → fmtDateTimeRu из lib/dates'],
  ]

  it.each(files)('%s не форматирует даты в обход lib/dates', (file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8')
    for (const [re, fix] of BANNED) {
      expect(re.test(src), `${file}: найден сырой вызов (${fix})`).toBe(false)
    }
  })

  // Сам механизм: строка НЕ должна зависеть от TZ процесса (в этом и была бага —
  // Vercel-UTC и браузер клиента давали разные строки). Ожидания ниже верны при
  // любой TZ раннера — проверено запуском под TZ=America/New_York.
  it('хелпер даёт московскую дату независимо от TZ процесса', () => {
    // 23:30 UTC = 02:30 следующего дня по Москве — ровно окно инцидента.
    expect(fmtDateRu('2026-07-29T23:30:00Z')).toBe('30.07.2026')
    expect(fmtDateTimeRu('2026-07-29T23:30:00Z')).toBe('30.07.2026, 02:30:00')
  })
})
