import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Страж класса «роут отдаёт клиенту сырой error.message» (уроки 17/31 июля и
// 3 августа): сырой message тащит хвосты провайдера («429 You have no credits…
// platform.openai.com/billing» дословно уехал клиенту 31 июля) и постгрес-
// внутренности (RLS, duplicate key). Правило: в ответ клиенту — только готовый
// русский текст; сырец — в captureException → error_events.
//
// Покрытие: ВСЕ app/api/**/route.ts, кроме admin/* (админу сырец полезен для
// разбора) и */webhook/* (читатель — платёжка и наши логи, не человек;
// logWebhook пишет сырец в error_events намеренно) — тест читает исходники,
// как anti-tells.test.ts.
//
// Легальные паттерны, которые regex НЕ ловит: rl.message (наши тексты
// рейт-лимита), access.error (наши тексты доступа), переменные с готовым
// текстом (raw с доменной проверкой в projects/route.ts).

const API_DIR = join(process.cwd(), 'app', 'api')

function collectRoutes(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'admin' || name === 'webhook') continue
      out.push(...collectRoutes(p))
    } else if (name === 'route.ts') out.push(p)
  }
  return out
}

// Сырой message в ответе клиенту: и NextResponse.json({error: …}), и SSE
// send({message: …}). Ловим обращения к .message у переменных ошибок.
const RAW_MESSAGE_IN_RESPONSE =
  /(?:error|message):\s*(?:\w+\s+instanceof\s+Error\s*\?\s*)?(?:e|err|error|upErr|insErr|saveErr|signErr|delErr)\??\.message/

describe('API-роуты не отдают сырой error.message клиенту (кроме admin/*)', () => {
  const routes = collectRoutes(API_DIR)
  it('нашёл роуты для проверки', () => {
    expect(routes.length).toBeGreaterThan(30)
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
