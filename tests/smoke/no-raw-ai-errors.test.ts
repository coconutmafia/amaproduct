import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Страж класса «AI-роут отдаёт клиенту сырой error.message» (уроки 17/31 июля
// и 3 августа): сырой message тащит хвосты провайдера — «429 You have no
// credits… platform.openai.com/billing» дословно уехал клиенту 31 июля.
// Правило: в главном catch AI-роута сырец идёт в captureException, клиенту —
// готовый русский текст (AI_BUSY_MESSAGE или свой честный).
//
// Тест читает ИСХОДНИКИ app/api/ai/*/route.ts (как anti-tells.test.ts) и
// запрещает паттерны «error: <e|err|error>…message» в JSON-ответах и SSE.

const AI_DIR = join(process.cwd(), 'app', 'api', 'ai')

function collectRoutes(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...collectRoutes(p))
    else if (name === 'route.ts') out.push(p)
  }
  return out
}

// Сырой message в ответе клиенту. Ловим и NextResponse.json, и send({message}).
// rl.message (наш текст рейт-лимита) и access.error (наши тексты доступа) —
// легальны и под паттерн не попадают.
const RAW_MESSAGE_IN_RESPONSE =
  /(?:error|message):\s*(?:\w+\s+instanceof\s+Error\s*\?\s*)?(?:e|err|error|upErr|insErr|saveErr)\.message/

describe('AI-роуты не отдают сырой error.message клиенту', () => {
  const routes = collectRoutes(AI_DIR)
  it('нашёл роуты для проверки', () => {
    expect(routes.length).toBeGreaterThan(10)
  })
  for (const route of routes) {
    it(route.replace(process.cwd(), ''), () => {
      const src = readFileSync(route, 'utf8')
      const lines = src.split('\n')
      const offenders = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) =>
          RAW_MESSAGE_IN_RESPONSE.test(l) &&
          !l.trim().startsWith('//') &&
          !l.includes('captureException') &&
          !l.includes('console.'))
        .map(({ l, i }) => `${i + 1}: ${l.trim()}`)
      expect(offenders, `Сырой message уходит клиенту:\n${offenders.join('\n')}`).toEqual([])
    })
  }
})
