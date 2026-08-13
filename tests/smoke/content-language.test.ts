import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolveContentLanguage,
  getContentLanguageDirective,
  detectTextLanguage,
} from '@/lib/ai/prompts/content-brain'
import { contentItemToText } from '@/lib/contentToText'

// ─────────────────────────────────────────────────────────────────────────────
// «Язык блога» (миграция 038, задача 13 августа: английский — первый класс).
// Главный инвариант КЛАССА: проекты БЕЗ настройки ведут себя РОВНО как до
// миграции («язык ответа = язык TOV, иначе русский») — на этом живёт испанский
// контент Katia Ustina и все русские проекты. Если страж упал — ты сломал
// существующего клиента, а не «улучшил дефолт».
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveContentLanguage: настройка проекта → язык контента', () => {
  it('явные ru/en/es распознаются (с нормализацией регистра/пробелов)', () => {
    expect(resolveContentLanguage({ content_language: 'en' })).toBe('en')
    expect(resolveContentLanguage({ content_language: ' EN ' })).toBe('en')
    expect(resolveContentLanguage({ content_language: 'ru' })).toBe('ru')
    expect(resolveContentLanguage({ content_language: 'es' })).toBe('es')
  })
  it('нет настройки / мусор → null (легаси-поведение, НЕ русский по умолчанию)', () => {
    expect(resolveContentLanguage(null)).toBeNull()
    expect(resolveContentLanguage(undefined)).toBeNull()
    expect(resolveContentLanguage({})).toBeNull()
    expect(resolveContentLanguage({ content_language: null })).toBeNull()
    expect(resolveContentLanguage({ content_language: '' })).toBeNull()
    expect(resolveContentLanguage({ content_language: 'de' })).toBeNull()
    expect(resolveContentLanguage({ content_language: 'english' })).toBeNull()
  })
})

describe('директива языка в системном промпте', () => {
  it('null → ДОСЛОВНО старое правило (обратная совместимость: Katia Ustina, испанский через TOV)', () => {
    expect(getContentLanguageDirective(null))
      .toBe('Язык ответа: тот, на котором написан TOV. Если TOV нет — русский.')
  })
  it('en → жёсткая директива: весь контент на английском, разговор — на языке пользователя', () => {
    const d = getContentLanguageDirective('en')
    expect(d).toContain('АНГЛИЙСКИЙ')
    expect(d).toContain('ТОЛЬКО на этом языке')
    expect(d).toContain('на языке его сообщений')
  })
  it('ru явный → контент строго русский (защита от дрейфа на смешанных материалах)', () => {
    expect(getContentLanguageDirective('ru')).toContain('РУССКИЙ')
  })
  it('es → испанская директива (живой кейс: Katia Ustina может закрепиться настройкой)', () => {
    expect(getContentLanguageDirective('es')).toContain('ИСПАНСКИЙ')
  })
})

describe('detectTextLanguage: эвристика для роутов без projectId (карусель/хуки/сторис)', () => {
  it('английский текст → en', () => {
    expect(detectTextLanguage(
      'Painting taught me to notice things I used to walk past every single day of my life.'
    )).toBe('en')
  })
  it('русский текст → null (русская ветка запретов)', () => {
    expect(detectTextLanguage(
      'Запустились на миллион рублей, а продаж вообще не было — разбираю, что пошло не так.'
    )).toBeNull()
  })
  it('короткий текст → null (не судим по паре слов)', () => {
    expect(detectTextLanguage('SWIPE')).toBeNull()
  })
  it('смешанный текст с преобладанием кириллицы → null', () => {
    expect(detectTextLanguage(
      'Мой новый пост про selfcare и work-life balance: как я перестала выгорать и начала жить.'
    )).toBeNull()
  })
})

describe('система промптов: цепочка языка не рвётся', () => {
  it('system.ts строит директиву и запреты по языку проекта', () => {
    const src = readFileSync(join(process.cwd(), 'lib/ai/prompts/system.ts'), 'utf8')
    expect(src).toContain('getContentLanguageDirective')
    expect(src).toContain('resolveContentLanguage')
    expect(src).toContain('getAiTells')
    // Старая захардкоженная строка не должна вернуться в обход директивы
    expect(src).not.toContain('Язык ответа: тот, на котором написан TOV')
  })
  it('generate: примеры-значения в JSON-шаблонах ветвятся по языку (isEn)', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/ai/generate/route.ts'), 'utf8')
    expect(src).toContain("'30-60 sec'")
    expect(src).toContain('"Option A"')
    expect(src).toMatch(/isEn \? 'Day' : 'День'/)
  })
  it('extract-tone-of-voice: язык описания не прибит к русскому + цитаты дословно', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/ai/extract-tone-of-voice/route.ts'), 'utf8')
    expect(src).toContain('resolveContentLanguage')
    expect(src).toContain('ДОСЛОВНО на языке автора')
    // Безусловное «, на русском,» в структуре ответа — регресс к старому багу
    expect(src).not.toMatch(/СТРУКТУРА ОТВЕТА \(в свободной форме, на русском/)
  })
  it('проектные PATCH принимают content_language только из белого списка', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/projects/route.ts'), 'utf8')
    expect(src).toContain("['ru', 'en', 'es']")
    expect(src).toContain('Bad content_language')
  })
  it('раскадровка сторис ловит и английский придуманный CTA (dm me / link in bio)', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/ai/plan-stories/route.ts'), 'utf8')
    expect(src.toLowerCase()).toContain('dm me')
    expect(src.toLowerCase()).toContain('link in (my )?bio')
  })
  it('карусельный рендер: подпись-листалка языкозависимая (SWIPE для en)', () => {
    const brandKit = readFileSync(join(process.cwd(), 'app/api/brand-kit/route.ts'), 'utf8')
    expect(brandKit).toContain("en: 'SWIPE →'")
    const engine = readFileSync(join(process.cwd(), 'lib/carousel/engine.tsx'), 'utf8')
    expect(engine).toContain('theme.swipeLabel')
    // Захардкоженная русская подпись в JSX рендера — регресс
    expect(engine).not.toMatch(/>ЛИСТАЙ ДАЛЬШЕ →</)
  })
})

describe('contentItemToText: метки блоков подстраиваются под язык контента', () => {
  const enReels = {
    structured_data: {
      reels: {
        title: 'Why I stopped posting only paintings',
        hook_text: 'I almost deleted this account last winter',
        scenes: [
          { scene: 1, timing: '0-3 sec', text_overlay: 'I almost quit', audio: { speech: 'Last winter I nearly deleted this whole account, and nobody knew about it.' }, visual: { action: 'Walks into the studio and turns on the light' } },
        ],
        description_text: 'The story behind the account you follow today.',
      },
    },
  }
  it('английский рилз → английские метки (Scene / Voiceover), без «Сцена/Озвучка»', () => {
    const text = contentItemToText(enReels)
    expect(text).toContain('Scene 1')
    expect(text).toContain('Voiceover:')
    expect(text).not.toContain('Сцена')
    expect(text).not.toContain('Озвучка')
  })
  it('русский рилз → русские метки, как всегда (без регрессий)', () => {
    const ruReels = {
      structured_data: {
        reels: {
          title: 'Почему я перестала постить только картины',
          hook_text: 'Прошлой зимой я чуть не удалила этот аккаунт',
          scenes: [
            { scene: 1, timing: '0-3 сек', text_overlay: 'Я чуть не ушла', audio: { speech: 'Прошлой зимой я чуть не удалила весь этот аккаунт, и никто об этом не знал.' }, visual: { action: 'Заходит в мастерскую и включает свет' } },
          ],
        },
      },
    }
    const text = contentItemToText(ruReels)
    expect(text).toContain('Сцена 1')
    expect(text).toContain('Озвучка:')
  })
  it('body_text имеет приоритет — детект не переписывает готовый текст', () => {
    expect(contentItemToText({ body_text: 'готовый текст', structured_data: enReels.structured_data }))
      .toBe('готовый текст')
  })
})
