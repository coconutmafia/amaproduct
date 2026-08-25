import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { wrapAnthropicForUsage } from '@/lib/ai/client'

// Обёртка учёта токенов молчала в проде (динамический импорт падал, .catch его
// глотал), и увидеть это можно было ТОЛЬКО по пустой таблице ai_usage. Здесь
// сам механизм перехвата проверяется подставным SDK — без сети, без деплоя.

type Logged = { route: string; model: string; usage?: { input_tokens?: number; output_tokens?: number } | null }

function harness() {
  const logged: Logged[] = []
  const log = (route: string, model: string, usage?: { input_tokens?: number; output_tokens?: number } | null) =>
    { logged.push({ route, model, usage }) }
  const calls: unknown[] = []
  const fakeSdk = {
    apiKey: 'test',
    messages: {
      create: async (body: unknown) => { calls.push(body); return { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 11, output_tokens: 22 } } },
      stream: (body: unknown) => { calls.push(body); return { finalMessage: async () => ({ usage: { input_tokens: 33, output_tokens: 44 } }) } },
      countTokens: async () => ({ input_tokens: 5 }),
    },
  }
  return { logged, calls, wrapped: wrapAnthropicForUsage(fakeSdk, log, () => 'test/route') }
}

describe('обёртка учёта токенов', () => {
  it('messages.create логирует токены и возвращает ответ SDK без изменений', async () => {
    const { logged, wrapped } = harness()
    const res = await wrapped.messages.create({ model: 'claude-opus-5', max_tokens: 10 } as never)
    expect((res as { content: unknown[] }).content).toHaveLength(1) // ответ не подменён
    await Promise.resolve() // логирование fire-and-forget — даём микротаску
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({ route: 'test/route', model: 'claude-opus-5' })
    expect(logged[0].usage).toEqual({ input_tokens: 11, output_tokens: 22 })
  })

  it('messages.stream логирует токены из finalMessage', async () => {
    const { logged, wrapped } = harness()
    const stream = wrapped.messages.stream({ model: 'claude-opus-5' } as never)
    await stream.finalMessage()
    await Promise.resolve()
    expect(logged).toHaveLength(1)
    expect(logged[0].usage).toEqual({ input_tokens: 33, output_tokens: 44 })
  })

  it('прочие поля SDK проходят насквозь (обёртка ничего не ломает)', async () => {
    const { wrapped } = harness()
    expect((wrapped as { apiKey: string }).apiKey).toBe('test')
    const c = await wrapped.messages.countTokens()
    expect(c).toEqual({ input_tokens: 5 })
  })

  it('падение вызова не роняет обёртку и ничего не логирует', async () => {
    const logged: Logged[] = []
    const failing = { messages: { create: async (_body: unknown) => { throw new Error('502 от провайдера') } } }
    const wrapped = wrapAnthropicForUsage(failing, (r, m, u) => { logged.push({ route: r, model: m, usage: u }) }, () => 'r')
    await expect(wrapped.messages.create({ model: 'm' } as never)).rejects.toThrow('502 от провайдера')
    await Promise.resolve()
    expect(logged).toHaveLength(0)
  })

  it('журнал импортируется СТАТИЧЕСКИ (динамический import() уже молчал в проде)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'lib', 'ai', 'client.ts'), 'utf8')
    expect(src, 'logAiUsage должен быть статическим импортом').toMatch(/^import \{ logAiUsage \} from '@\/lib\/ai\/usageLog'$/m)
    expect(src, 'динамический import() журнала запрещён').not.toMatch(/import\(['"]@\/lib\/ai\/usage/)
  })
})
