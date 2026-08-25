import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Стражи перехода на claude-opus-5 (25.08.2026, решение Матвея).
// Перед переходом ЗАМЕРЕНО (scratchpad style-eval + compat-probe):
//  • стиль: 0 нарушений анти-AI-правил из 12 генераций (у 4.8 — 1), JSON 100%;
//  • форс-тул работает без thinking-параметра;
//  • диалог, кончающийся assistant-сообщением, даёт 400 на ОБЕИХ моделях
//    («no assistant prefill») — цикл продолжения чата был сломан молча;
//  • у opus-5 размышление включено: первый блок ответа — thinking, и
//    content[0] «молча возвращает пустоту» — класс content-first-block.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

function collectTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      out.push(...collectTs(p))
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(p)
  }
  return out
}
const sources = [...collectTs(join(ROOT, 'app')), ...collectTs(join(ROOT, 'lib'))]

describe('модели: один источник правды', () => {
  it('контентная модель по умолчанию — claude-opus-5', () => {
    expect(read('lib/ai/client.ts')).toContain("|| 'claude-opus-5'")
  })
  it('нет захардкоженных id моделей вне lib/ai/client.ts', () => {
    // Хардкод пережил бы смену общей настройки и однажды умер бы с отключением
    // модели провайдером (так жили autofill и scrape-product на sonnet-4-5).
    const offenders = sources
      .filter(p => !p.endsWith('lib/ai/client.ts'))
      .flatMap(p => {
        const src = readFileSync(p, 'utf8')
        return src.match(/claude-(?:opus|sonnet|haiku|fable)-[\w.-]+/) ? [p.replace(ROOT, '')] : []
      })
    expect(offenders, `Хардкод модели вне client.ts:\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('opus-5: thinking-совместимость ответов', () => {
  it('нигде нет content[0]-чтения текста (первым блоком идёт thinking)', () => {
    const offenders = sources.flatMap(p => {
      const src = readFileSync(p, 'utf8')
      const lines = src.split('\n')
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /content\[0\][?.]*\.type === 'text'/.test(l) && !l.trim().startsWith('//'))
        .map(({ i }) => `${p.replace(ROOT, '')}:${i + 1}`)
      return lines
    })
    expect(offenders, `content[0] вместо find(text):\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('чат: продолжение длинного ответа живо', () => {
  it('раунды 2+ кончаются user-ходом (assistant-хвост = 400 на 4.8 и 5)', () => {
    const chat = read('app/api/ai/chat/route.ts')
    expect(chat).toContain('Продолжи свой ответ ТОЧНО с места обрыва')
    // Запрещаем возврат старой формы: convo, кончающийся assistant без user
    expect(chat).not.toMatch(/\[\.\.\.cachedMessages,\s*\{ role: 'assistant' as const, content: acc \}\s*\]/)
  })
})
