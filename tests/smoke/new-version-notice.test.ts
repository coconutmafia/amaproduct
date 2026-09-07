import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CHUNK_ERROR_RE, shouldShowInsteadOfReload } from '@/components/shared/NewVersionNotice'

// Евгения 07.09: 5 выкладок за 2 часа в рабочее время; её ошибки 09:12:54 и
// 09:15:03 UTC совпали с деплоями секунда в секунду (ChunkLoadError на
// /stories, «network error» на /visual и /create). Класс: старая вкладка после
// деплоя не догружает чанки старой сборки. Стражи: ловим все формулировки
// браузеров, перезагружаем один раз, дальше — плашка; граница ошибок дашборда
// говорит то же самое; плашка смонтирована в корневом layout.
describe('новая версия при живой вкладке', () => {
  it('регэксп ловит формулировки Chrome/Safari/Firefox/Next', () => {
    for (const m of [
      'ChunkLoadError: Failed to load chunk /_next/static/chunks/08kao_fw.k29..js from module 964893',
      'Loading chunk 123 failed.',
      'Importing a module script failed.',
      'error loading dynamically imported module: https://amaproduct.com/_next/static/chunks/x.js',
      'Failed to fetch dynamically imported module: https://amaproduct.com/_next/static/chunks/x.js',
    ]) expect(CHUNK_ERROR_RE.test(m), m).toBe(true)
    expect(CHUNK_ERROR_RE.test('TypeError: network error')).toBe(false)
    expect(CHUNK_ERROR_RE.test('Unauthorized')).toBe(false)
  })

  it('перезагрузка один раз: вторая в течение 2 минут → плашка, а не цикл', () => {
    expect(shouldShowInsteadOfReload(1_000_000, () => null)).toBe(false)
    expect(shouldShowInsteadOfReload(1_000_000, () => String(1_000_000 - 30_000))).toBe(true)
    expect(shouldShowInsteadOfReload(1_000_000, () => String(1_000_000 - 5 * 60_000))).toBe(false)
    expect(shouldShowInsteadOfReload(1_000_000, () => { throw new Error('storage blocked') })).toBe(true)
  })

  it('смонтировано в корневом layout, граница ошибок дашборда есть и различает новую версию', () => {
    expect(readFileSync(`${process.cwd()}/app/layout.tsx`, 'utf8')).toContain('<NewVersionNotice />')
    const boundary = readFileSync(`${process.cwd()}/app/(dashboard)/error.tsx`, 'utf8')
    expect(boundary).toContain('CHUNK_ERROR_RE')
    expect(boundary).toContain('Вышла новая версия')
    expect(boundary).toContain('/api/client-error')
  })

  it('docs-only коммит не деплоится (vercel.json ignoreCommand): каждая выкладка бьёт по живым вкладкам', () => {
    const v = JSON.parse(readFileSync(`${process.cwd()}/vercel.json`, 'utf8')) as { ignoreCommand?: string }
    expect(v.ignoreCommand).toContain('(exclude)*.md')
    // 07.09 вечер: сравнение с HEAD^ отменило сборку пуша из двух коммитов (код + docs) —
    // база должна быть ПОСЛЕДНИЙ ЗАДЕПЛОЕННЫЙ коммит, а не предыдущий в истории
    expect(v.ignoreCommand).toContain('VERCEL_GIT_PREVIOUS_SHA')
    expect(v.ignoreCommand).toContain('|| exit 1') // база неизвестна → собирать
  })
})
