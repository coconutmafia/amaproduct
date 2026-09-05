import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolveContentLanguage, getContentLanguageDirective, getAiTells, detectTextLanguage,
} from '@/lib/ai/prompts/content-brain'

// Язык контента живёт в НЕСКОЛЬКИХ местах (тип, валидация роута, кнопки UI,
// анти-AI ветки, метки слайдов, свайп карусели, язык Whisper у монтажа).
// Инцидент-класс «добавили кнопку, забыли ветки» ловится этим файлом:
// каждый язык обязан присутствовать во ВСЕХ точках сразу.
// 'it' добавлен 03.09 (кастдевы итальянского фотографа — вопрос Кристины).

const LANGS = ['ru', 'en', 'es', 'de', 'it']
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('итальянский (и каждый язык) добавлен во все точки, не одной кнопкой', () => {
  it('UI-кнопки, серверная валидация и тип согласованы', () => {
    const ui = read('components/projects/ProjectInfoSection.tsx')
    const route = read('app/api/projects/route.ts')
    const brain = read('lib/ai/prompts/content-brain.ts')
    for (const l of LANGS.filter(l => l !== 'ru')) {
      expect(ui, `нет кнопки '${l}' в UI`).toContain(`value: '${l}'`)
    }
    expect(route).toContain("['ru', 'en', 'es', 'de', 'it']")
    expect(brain).toContain("['ru', 'en', 'es', 'de', 'it']")
  })

  it('resolveContentLanguage принимает it, директива называет язык', () => {
    expect(resolveContentLanguage({ content_language: 'it' })).toBe('it')
    expect(getContentLanguageDirective('it')).toContain('ИТАЛЬЯНСКИЙ')
  })

  it('анти-AI ветка итальянского — родная, а не русская заглушка', () => {
    const tells = getAiTells('it')
    expect(tells).toContain('COME NON SEMBRARE')
    expect(tells).toContain('PARALLELISMO NEGATIVO')
    expect(tells).not.toBe(getAiTells(null))
  })

  it('detectTextLanguage: итальянский распознаётся и не ломает соседей', () => {
    const itText = 'Non è solo una questione di talento, perché anche quando la vita cambia, questo lavoro mi dà più energia di prima. C\'è qualcosa che devo raccontare della mia storia, ma non so da dove cominciare davvero.'
    const esText = 'No es solo una cuestión de talento, porque cuando la vida cambia, este trabajo me da más energía que antes. Hay algo que debo contar de mi historia, pero no sé por dónde empezar. ¿Sabes qué es lo más importante para una persona?'
    const deText = 'Es ist nicht nur eine Frage des Talents, denn auch wenn sich das Leben ändert, gibt mir diese Arbeit mehr Energie als früher. Ich muss etwas über meine Geschichte erzählen, aber ich weiß nicht, wie ich anfangen soll.'
    const enText = 'It is not just a question of talent, because even when life changes, this work gives me more energy than before. There is something that I have to tell about my story, but I do not know where to start.'
    expect(detectTextLanguage(itText)).toBe('it')
    expect(detectTextLanguage(esText)).toBe('es')
    expect(detectTextLanguage(deText)).toBe('de')
    expect(detectTextLanguage(enText)).toBe('en')
    expect(detectTextLanguage('Обычный русский текст о том, как вести блог и не выгорать, письмо для рассылки.')).toBe(null)
  })

  it('метки слайдов/сцен: у чата и редактора есть итальянская ветка', () => {
    for (const p of ['lib/ai/chatContext.ts', 'app/api/ai/edit/route.ts']) {
      const src = read(p)
      expect(src, p).toContain("l === 'it'")
      expect(src, p).toContain('Scena 1')
    }
  })

  it('ToV, углы, корректор и экспорт знают итальянский', () => {
    expect(read('app/api/ai/extract-tone-of-voice/route.ts')).toContain('НА ИТАЛЬЯНСКОМ ЯЗЫКЕ')
    expect(read('app/api/ai/suggest-angles/route.ts')).toContain("'итальянском'")
    expect(read('lib/ai/prompts/system.ts')).toContain('текст итальянский')
    const c2t = read('lib/contentToText.ts')
    expect(c2t).toContain('it: {')
    expect(c2t).toContain('L10N.it')
  })

  it('свайп карусели и язык Whisper монтажа/рилсов включают it', () => {
    expect(read('app/api/brand-kit/route.ts')).toContain("it: 'SCORRI →'")
    expect(read('lib/jobs/runMontageJob.ts')).toContain("cl === 'it'")
    expect(read('lib/jobs/runViralReelJob.ts')).toContain("cl === 'it'")
  })
})
