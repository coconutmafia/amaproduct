import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AI_TELLS_TO_AVOID, AI_TELLS_TO_AVOID_EN, AI_TELLS_TO_AVOID_ES, AI_TELLS_TO_AVOID_DE, getAiTells, PLATFORM_SAFE_LANGUAGE } from '@/lib/ai/prompts/content-brain'

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

// Английский близнец запретов (для блогов на английском — Darina Komorowski и
// далее): паттерны, по которым англоязычный читатель мгновенно узнаёт ChatGPT.
// Если кто-то удалит пункт из EN-ветки — CI упадёт, как и с русской.
describe('английские анти-AI-запреты закреплены в промпте', () => {
  const enMustMention = [
    'em dash',            // тире — главный маркер AI-английского
    "It's not just",      // negative parallelism «it's not just X, it's Y»
    "Here's the thing",   // фальшиво-доверительные подводки
    'Let\'s dive in',     // сигнатурная AI-подводка
    'delve',              // AI-словарь
    'game-changer',       // AI-словарь
    'DM me',              // пустые офферы
  ]
  it.each(enMustMention)('EN-ветка запрещает «%s»', (phrase) => {
    expect(AI_TELLS_TO_AVOID_EN.toLowerCase()).toContain(phrase.toLowerCase())
  })

  it('правило устной речи для рилз есть и в EN-ветке', () => {
    expect(AI_TELLS_TO_AVOID_EN).toContain('SPOKEN LANGUAGE')
    expect(AI_TELLS_TO_AVOID_EN).toMatch(/10-25 words/)
  })

  it('запрет staccato-фрагментов (существительные через точку по-английски)', () => {
    expect(AI_TELLS_TO_AVOID_EN).toContain('STACCATO')
  })

  it('getAiTells ветвится по языку; null (нет настройки) = русская ветка, как до 038', () => {
    expect(getAiTells('en')).toBe(AI_TELLS_TO_AVOID_EN)
    expect(getAiTells('es')).toBe(AI_TELLS_TO_AVOID_ES)
    expect(getAiTells('de')).toBe(AI_TELLS_TO_AVOID_DE)
    expect(getAiTells(null)).toBe(AI_TELLS_TO_AVOID)
    expect(getAiTells('ru')).toBe(AI_TELLS_TO_AVOID)
  })
})

// Испанская и немецкая ветки (решение Матвея 13.08: блоги клиентов бывают на
// en/es/de — качество как у русского). Ключевые запреты каждого языка закреплены.
describe('испанские и немецкие анти-AI-запреты закреплены', () => {
  it.each(['No es solo', 'Seamos honestos', 'desbloquear', 'Mar. Sol.'])('ES-ветка запрещает «%s»', (phrase) => {
    expect(AI_TELLS_TO_AVOID_ES.toLowerCase()).toContain(phrase.toLowerCase())
  })
  it('ES: устная речь рилз 10-25 слов', () => {
    expect(AI_TELLS_TO_AVOID_ES).toMatch(/10-25 palabras/)
  })
  it.each(['nicht nur', 'Mal ehrlich', 'entfesseln', 'Meer. Sonne.', 'Nominalstil'])('DE-ветка запрещает «%s»', (phrase) => {
    expect(AI_TELLS_TO_AVOID_DE.toLowerCase()).toContain(phrase.toLowerCase())
  })
  it('DE: устная речь рилз 10-25 слов', () => {
    expect(AI_TELLS_TO_AVOID_DE).toMatch(/10-25 Wörter/)
  })
})

describe('безопасность охватов Instagram/Meta закреплена в промпте', () => {
  it('запрещает абсолютные гарантии и generic engagement-bait', () => {
    expect(PLATFORM_SAFE_LANGUAGE).toContain('Гарантированный результат')
    expect(PLATFORM_SAFE_LANGUAGE).toContain('Гарантированный доход')
    expect(PLATFORM_SAFE_LANGUAGE.toLowerCase()).toContain('лайкни, если согласен'.toLowerCase())
    expect(PLATFORM_SAFE_LANGUAGE.toLowerCase()).toContain('отметь друга'.toLowerCase())
  })
  it('английские примеры гарантий и бейта тоже на месте (для EN-блогов)', () => {
    expect(PLATFORM_SAFE_LANGUAGE.toLowerCase()).toContain('guaranteed results')
    expect(PLATFORM_SAFE_LANGUAGE.toLowerCase()).toContain('tag a friend')
    expect(PLATFORM_SAFE_LANGUAGE.toLowerCase()).toContain('like if you agree')
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
    'lib/ai/weekBrief.ts',                      // темы контент-плана (ядро с 24.08: роут и джоб)
    'lib/ai/warmupPlan.ts',                     // план прогрева (ядро с 24.08: роут и джоб)
    'app/api/ai/suggest-angles/route.ts',       // углы/хуки
  ]
  // С августа 2026 запрет двухъязычный: роут может брать константу напрямую
  // (AI_TELLS_TO_AVOID) или через языковой селектор getAiTells(lang) — обе
  // дороги ведут в тот же content-brain. Роут БЕЗ обоих = запрет отвалился.
  it.each(routesThatMustBan)('%s подключает анти-AI-запреты (AI_TELLS_TO_AVOID или getAiTells)', (route) => {
    const src = readFileSync(join(process.cwd(), route), 'utf8')
    expect(src, `${route} должен подключать запреты из content-brain (AI_TELLS_TO_AVOID или getAiTells)`)
      .toMatch(/AI_TELLS_TO_AVOID|getAiTells/)
  })

  // generate идёт через buildSystemPrompt (system.ts), который включает запрет
  // через языковой селектор getAiTells (ru или en ветка по настройке проекта) —
  // проверяем оба звена цепочки, чтобы она не порвалась ни в одном месте.
  it('generate получает запрет через buildSystemPrompt', () => {
    const route = readFileSync(join(process.cwd(), 'app/api/ai/generate/route.ts'), 'utf8')
    expect(route).toContain('buildSystemPrompt')
    const system = readFileSync(join(process.cwd(), 'lib/ai/prompts/system.ts'), 'utf8')
    expect(system).toContain('getAiTells')
  })
})
