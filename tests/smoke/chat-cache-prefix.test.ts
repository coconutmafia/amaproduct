import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Кэш промпта в чате (замер 04.09, Даша): 77% цены — ПЕРЕЗАПИСЬ кэша, потому
// что брейкпоинт стоял на последнем сообщении с приклеенными RAG-фрагментами;
// на следующем ходу то же сообщение шло без них — префикс истории расходился,
// вся история переписывалась по 2×. Стражи: брейкпоинт на предпоследнем,
// последнее без cache_control, «Готовое» — отдельный system-блок.
describe('чат: кэш-префикс истории не ломается переменными фрагментами', () => {
  const src = readFileSync(`${process.cwd()}/app/api/ai/chat/route.ts`, 'utf8')

  it('брейкпоинт истории — на предпоследнем сообщении, последнее без кэша', () => {
    expect(src).toContain('const isBreakpoint = i === messages.length - 2')
    // блок последнего сообщения не содержит cache_control
    const lastBlock = src.slice(src.indexOf('if (isLast) {'), src.indexOf('if (isBreakpoint) {'))
    expect(lastBlock).not.toContain('cache_control')
  })

  it('RAG-фрагменты по-прежнему приклеиваются только к последнему сообщению', () => {
    expect(src).toContain('isLast && matchesBlock')
  })

  it('«Готовое» — отдельный кэш-блок, а не хвост стабильных материалов', () => {
    expect(src).toContain('streamingChatResponse([systemPrompt, savedBlock]')
    expect(src).not.toContain('${baseSystem}${savedBlock}')
    expect(src).toContain('buildCachedSystemBlocks(systemBlocks)')
    const client = readFileSync(`${process.cwd()}/lib/ai/client.ts`, 'utf8')
    expect(client).toContain('export function buildCachedSystemBlocks')
  })

  it('пробник кэша ловит перезапись истории на ходах 2+', () => {
    const probe = readFileSync(`${process.cwd()}/scripts/prod-probe.mjs`, 'utf8')
    expect(probe).toContain('ПЕРЕЗАПИСЬ КЭША')
    expect(probe).toContain('cacheWrite1h')
  })
})
