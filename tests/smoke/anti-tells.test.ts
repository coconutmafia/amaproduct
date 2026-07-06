import { describe, it, expect } from 'vitest'
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
