import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tokenize } from '../../lib/carousel/engine'

// Стражи багов Станислава Сунгатулина (видео 25.08, чат «Ошибки»):
//  1) «разбил текст на абзацы, сохранил — обратно сжало»: редактор показывает
//     пустые строки (pre-wrap), а экспорт схлопывал их в ноль;
//  2) «второй раз редактировать — вообще чёрный экран»: у ручного кадра
//     headline/body пустые и фото нет — редактор открывал пустой чёрный холст;
//  3) «просил добавить 14-й — 6 штук удалил»: серия из 13 кадров не влезала в
//     max_tokens 2500, модель возвращала МЕНЬШЕ кадров, серия перезаписывалась
//     урезанной, файлы выпавших кадров удалялись из хранилища;
//  4) «сделал 13 — в сохранённых 10»: сервер молча резал серию slice(0, 10).

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('пустые строки переживают экспорт (баг «текст сжимается»)', () => {
  it('tokenize метит пустую строку как blank', () => {
    const toks = tokenize('Первый абзац\n\nВторой абзац')
    const brs = toks.filter(t => t.br)
    expect(brs.length).toBe(2)
    expect(brs[0].blank).toBe(true)   // переход через пустую строку
    expect(brs[1].blank).toBe(false)  // обычный перенос
  })
  it('обычный перенос строки blank не получает', () => {
    const toks = tokenize('Строка один\nСтрока два')
    const brs = toks.filter(t => t.br)
    expect(brs.length).toBe(1)
    expect(brs[0].blank).toBe(false)
  })
  it('рендеры дают пустой строке высоту (не height: 0)', () => {
    const engine = read('lib/carousel/engine.tsx')
    expect(engine).toMatch(/it\.blank \? Math\.round\(o\.size \* 1\.18\) : 0/) // RichText
    expect(engine).toMatch(/line\.length === 0 \?/)                            // StoryText
    expect(engine).not.toMatch(/return lines\.filter\(\(l\) => l\.length > 0\)/) // пустые не выбрасываются огульно
  })
})

describe('ручной кадр открывается со своей раскладкой (баг «чёрный экран»)', () => {
  it('редактор отдаёт слайд вместе с картинкой (снимок на момент экспорта)', () => {
    const ed = read('components/carousel/StoryEditor.tsx')
    expect(ed).toContain('slide: SlideValue }) => Promise<void> | void')
    expect(ed).toContain('setResultSlide(')
    expect(ed).toContain('slide: resultSlide ?? slide')
  })
  it('StoriesPanel: design хранится, повторная правка открывает блоки, легаси — картинкой-фоном', () => {
    const sp = read('components/content/StoriesPanel.tsx')
    expect(sp).toContain('design: JSON.parse(JSON.stringify(slide))')
    expect(sp).toContain('frame.design') // manual-ветка editFrameManually
    expect(sp).toContain('manualUrl: sf.manual ? sf.url : undefined') // фолбэк для старых серий
    expect(sp).not.toMatch(/addManualToSeries\(\{ blob, index \}: \{ blob: Blob; index: number \}\)/)
  })
  it('ContentStudio (карусель): тот же класс — design у ручного слайда', () => {
    const cs = read('components/content/ContentStudio.tsx')
    expect(cs).toContain('manual: true, design')
    expect(cs).toMatch(/slides\[i\]\?\.manual \? slides\[i\]\?\.design/)
  })
  it('роут серий пропускает design и восстанавливает его при открытии', () => {
    const route = read('app/api/stories/sets/route.ts')
    expect(route).toMatch(/design: \(f\.manual && f\.design/)
    const sp = read('components/content/StoriesPanel.tsx')
    expect(sp).toContain('design: sf.design')
  })
})

describe('правка серии не теряет кадры (баг «6 штук удалил»)', () => {
  it('edit-stories: потолок ≥ 12000, обрезка по max_tokens не принимается', () => {
    const r = read('app/api/ai/edit-stories/route.ts')
    const m = r.match(/max_tokens:\s*(\d+)/)
    expect(Number(m?.[1] ?? 0)).toBeGreaterThanOrEqual(12000)
    expect(r).toContain("res.stop_reason === 'max_tokens'")
  })
  it('edit-stories: серверный страж — меньше кадров без просьбы удалить = 502', () => {
    const r = read('app/api/ai/edit-stories/route.ts')
    expect(r).toContain('out.length < frames.length && !deleteIntent')
    expect(r).toContain('ничего не меняю, чтобы не потерять кадры')
  })
  it('клиент: applyEdit не применяет и не пересохраняет урезанный ответ', () => {
    const sp = read('components/content/StoriesPanel.tsx')
    expect(sp).toContain('d.stories.length < rendered.length && !deleteIntent')
  })
  it('пустой элемент на месте ручного кадра не выбрасывается (индексы не съезжают)', () => {
    const r = read('app/api/ai/edit-stories/route.ts')
    expect(r).toContain('i < frames.length && !(frames[i]?.headline || frames[i]?.body)')
    expect(r).not.toMatch(/\.filter\(\(r\) => r\.headline \|\| r\.body\)/)
  })
  it('«добавь кадр»: правило N+1 в промпте + ретрай + честная ошибка', () => {
    const r = read('app/api/ai/edit-stories/route.ts')
    expect(r).toContain('ДОБАВИТЬ КАДР')
    expect(r).toContain('addIntent')
    expect(r).toContain('Не получилось добавить кадр')
  })
})

describe('сохранение серии без молчаливых обрезаний (баг «13 → 10»)', () => {
  it('потолок кадров сохранения ≥ 16 (макс. серии 13 с запасом)', () => {
    const route = read('app/api/stories/sets/route.ts')
    expect(route).not.toContain('slice(0, 10)')
    const m = route.match(/frames\.slice\(0,\s*(\d+)\)/)
    expect(Number(m?.[1] ?? 0)).toBeGreaterThanOrEqual(16)
  })
  it('фото хватает на каждый кадр серии (лимит 13, не 8)', () => {
    const sp = read('components/content/StoriesPanel.tsx')
    expect(sp).toContain('max={13}')
    expect(sp).not.toMatch(/uniqueMats\.slice\(0, 8\)/)
  })
})
