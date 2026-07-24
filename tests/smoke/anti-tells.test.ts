import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AI_TELLS_TO_AVOID, PLATFORM_SAFE_LANGUAGE } from '@/lib/ai/prompts/content-brain'

// Владелец продукта (Августа) лично ловила эти GPT-измы в контенте и требовала
// их убрать НАВСЕГДА («я с ними борюсь-борюсь, они всё равно возникают»).
// Этот тест — гарантия «не забудется»: если кто-то удалит запреты из промпта,
// CI упадёт. Не удалять пункты без явного решения владельца.
describe('запреты Августы закреплены в промпте', () => {
  const bannedMustBeMentioned = [
    'давай честно',      // «А теперь давай честно» — штампованная подводка
    'на пальцах',        // «разложу на пальцах»
    'вот тут самое',     // «И вот тут самое главное/страшное/…»
    'ровно то же самое', // «С инфопродуктами ровно то же самое»
    'И знаешь, что самое', // вопросительная форма (запрещена ранее)
  ]
  it.each(bannedMustBeMentioned)('промпт запрещает «%s»', (phrase) => {
    expect(AI_TELLS_TO_AVOID.toLowerCase()).toContain(phrase.toLowerCase())
  })

  it('правило устной речи для рилз на месте', () => {
    expect(AI_TELLS_TO_AVOID).toContain('УСТНАЯ РЕЧЬ')
    expect(AI_TELLS_TO_AVOID).toMatch(/10-25 слов/)
  })

  it('запрет тире и существительных через точку на месте', () => {
    expect(AI_TELLS_TO_AVOID).toContain('ТИРЕ')
    expect(AI_TELLS_TO_AVOID).toContain('СУЩЕСТВИТЕЛЬНЫЕ ЧЕРЕЗ ТОЧКУ')
  })
})

describe('безопасность охватов Instagram/Meta закреплена в промпте', () => {
  it('запрещает абсолютные гарантии и generic engagement-bait', () => {
    expect(PLATFORM_SAFE_LANGUAGE).toContain('Гарантированный результат')
    expect(PLATFORM_SAFE_LANGUAGE).toContain('Гарантированный доход')
    expect(PLATFORM_SAFE_LANGUAGE.toLowerCase()).toContain('лайкни, если согласен'.toLowerCase())
    expect(PLATFORM_SAFE_LANGUAGE.toLowerCase()).toContain('отметь друга'.toLowerCase())
  })
  it('НЕ запрещает продуктовый лид-магнит CTA (специфичный, не generic bait)', () => {
    expect(PLATFORM_SAFE_LANGUAGE).toContain('СТРАТЕГИЯ')
    expect(PLATFORM_SAFE_LANGUAGE).toContain('оставляй как есть')
  })
})

// Регрессия 21 июля: запрет БЫЛ в чате/правках, но генераторы ТЕМ писали мимо
// него (week-brief, warmup-plan, suggest-angles). Рубленая тема уходила
// сценаристу как задание — и сценарий эхом воспроизводил стиль, хотя у самого
// сценариста запрет стоял. Августа поймала это в контент-плане («фраза точка,
// фраза точка — сразу видно, что ИИ»). Тест гарантирует: КАЖДЫЙ роут, который
// генерирует пользовательский текст, подключает запрет.
describe('запрет AI-маркеров подключён во всех генераторах текста', () => {
  const routesThatMustBan = [
    'app/api/ai/chat/route.ts',
    'app/api/ai/edit/route.ts',
    'app/api/ai/edit-carousel/route.ts',
    'app/api/ai/edit-stories/route.ts',
    'app/api/ai/regenerate-fragment/route.ts',
    'app/api/ai/generate-week-brief/route.ts',  // темы контент-плана
    'app/api/ai/warmup-plan/route.ts',          // план прогрева
    'app/api/ai/suggest-angles/route.ts',       // углы/хуки
  ]
  it.each(routesThatMustBan)('%s импортирует AI_TELLS_TO_AVOID', (route) => {
    const src = readFileSync(join(process.cwd(), route), 'utf8')
    expect(src, `${route} должен импортировать AI_TELLS_TO_AVOID из content-brain`)
      .toContain('AI_TELLS_TO_AVOID')
  })

  // generate идёт через buildSystemPrompt (system.ts), который включает запрет —
  // проверяем оба звена цепочки, чтобы она не порвалась ни в одном месте.
  it('generate получает запрет через buildSystemPrompt', () => {
    const route = readFileSync(join(process.cwd(), 'app/api/ai/generate/route.ts'), 'utf8')
    expect(route).toContain('buildSystemPrompt')
    const system = readFileSync(join(process.cwd(), 'lib/ai/prompts/system.ts'), 'utf8')
    expect(system).toContain('AI_TELLS_TO_AVOID')
  })
})
