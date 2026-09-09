import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { plateTextColor, plateBackground } from '@/lib/carousel/plateStyle'
import { MAX_STORY_MATERIALS } from '@/lib/stories/limits'

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')

// Светлана Кундаль, 09.09. Четыре жалобы по сторис — все воспроизведены:
//  1. «сценарий на 16 сторис, а загрузить удалось 13 — кнопка пропала»;
//  2. «сделал все одинаково, непонятно почему выбрал эти цвета и шрифт»;
//  3. «изменить размер плашки с текстом невозможно» (мышью — правда, жест pinch);
//  4. «не удаётся поменять цвет шрифта — тыкаешь на кружочки, не меняется»
//     (замерено на проде: computed color оставался белым).
describe('плашка: цвет текста и фона — одно правило на превью и сервер', () => {
  it('явно выбранный цвет применяется НА ПЛАШКЕ, без выбора — цвет темы', () => {
    expect(plateTextColor({ color: '#2ECC71', colorSet: true }, '#FFFFFF')).toBe('#2ECC71')
    expect(plateTextColor({ color: '#2ECC71' }, '#FFFFFF')).toBe('#FFFFFF')
    // блок создаётся с color '#FFFFFF' — без флага он НЕ должен перекрашивать
    // сохранённые ранее оформления (белый текст на светлой плашке = потеря)
    expect(plateTextColor({ color: '#FFFFFF' }, '#1A1A1A')).toBe('#1A1A1A')
    expect(plateTextColor({}, '#1A1A1A')).toBe('#1A1A1A')
  })
  it('цвет плашки: выбранный, иначе фон темы', () => {
    expect(plateBackground({ plateColor: '#3E5C3A' }, '#3a2a20')).toBe('#3E5C3A')
    expect(plateBackground({}, '#3a2a20')).toBe('#3a2a20')
  })
  it('и превью, и движок зовут ОДНИ функции (иначе экспорт разъедется с превью)', () => {
    for (const p of ['components/carousel/FreeCanvas.tsx', 'lib/carousel/engine.tsx']) {
      const s = read(p)
      expect(s, p).toContain("from '@/lib/carousel/plateStyle'")
      expect(s, p).toMatch(/platedColor=\{plateTextColor\(/)
      expect(s, p).toMatch(/plateBg=\{plateBackground\(/)
    }
    // экспорт несёт новые поля на сервер — иначе цвет виден только в превью
    expect(read('components/carousel/FreeCanvas.tsx')).toContain('colorSet: b.colorSet, plateColor: b.plateColor')
    expect(read('lib/carousel/engine.tsx')).toMatch(/colorSet\?: boolean/)
  })
  it('палитра ставит флаг явного выбора, есть возврат «как в стиле» и палитра плашки', () => {
    const c = read('components/carousel/FreeCanvas.tsx')
    expect(c).toContain('{ color: c, colorSet: true }')
    expect(c).toContain('{ color: e.target.value, colorSet: true }')
    expect(c).toContain('{ colorSet: undefined }')
    expect(c).toContain('Цвет плашки:')
    expect(c).toContain('{ plateColor: undefined }')
  })
})

describe('ширина плашки и потолок материалов', () => {
  it('у текстового блока есть кнопки ширины (мышью жеста pinch нет)', () => {
    const c = read('components/carousel/FreeCanvas.tsx')
    expect(c).toContain('function widthSel(')
    expect(c).toContain('aria-label="уже плашку"')
    expect(c).toContain('aria-label="шире плашку"')
    // ± по-прежнему меняет кегль, а не ширину — это разные контролы
    expect(c).toContain("if (s.type === 'text') patch(s.id, { size: clamp(s.size + dir * 8, 22, 240) })")
  })
  it('материалов серии хватает на сценарий из 16 кадров', () => {
    expect(MAX_STORY_MATERIALS).toBeGreaterThanOrEqual(16)
    const s = read('components/content/StoriesPanel.tsx')
    expect(s).toContain('max={MAX_STORY_MATERIALS}')
    expect(s).toContain('uniqueMats.slice(0, MAX_STORY_MATERIALS)')
    expect(s).not.toMatch(/max=\{13\}/)
  })
})

describe('ручной кадр совпадает со стилем серии', () => {
  it('9:16 в редакторе берёт brand_kit.story (шрифт/фон/акцент сторис), как серия', () => {
    const e = read('components/carousel/StoryEditor.tsx')
    expect(e).toContain("canvasFormat === 'story' ? (d.kit?.story ?? {})")
    expect(e).toContain('story.font || d.font')
    expect(e).toContain('story.bg || d.bg')
    expect(e).toContain('[projectId, canvasFormat]')
  })
  it('серия: цвет плашек виден и меняется, источник цветов назван', () => {
    const s = read('components/content/StoriesPanel.tsx')
    expect(s).toContain('async function applyPlateColor(')
    expect(s).toContain('фирменного стиля')
    // ручные и видео-кадры перекраска не трогает — у них своё оформление
    expect(s).toContain("(r.frame.manual || r.frame.video) ? Promise.resolve(r.blob) : renderFrame(r.frame, i, color ?? null)")
  })
})
