import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isMediaFile, DIRECT_UPLOAD_BYTES, MAX_UPLOAD_BYTES, MEDIA_NOT_HERE } from '@/lib/materials/uploadRules'
import { normalizeCarousel, normalizeStories, isNoopEdit, NOOP_EDIT_MESSAGE } from '@/lib/ai/editDiff'

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')

// 08.09: Люба — 35-минутный созвон в обычную загрузку → «Ошибка 413» (потолок
// Vercel 4,5 МБ на тело запроса, до нашего кода); Алиса/Светлана — «правки
// проигнорировал» при 200 от модели (вернула то же самое, клиент писал
// «Правка применена»).
describe('загрузка: медиа не сюда, большие файлы — напрямую в хранилище', () => {
  it('isMediaFile: MIME, расширение и файлы без расширения из мессенджеров', () => {
    expect(isMediaFile('video1939196410', '')).toBe(true)
    expect(isMediaFile('audio1939196410', 'application/octet-stream')).toBe(true)
    expect(isMediaFile('созвон.mp4', 'video/mp4')).toBe(true)
    expect(isMediaFile('interview.m4a', '')).toBe(true)
    expect(isMediaFile('blob', 'audio/webm')).toBe(true)
    expect(isMediaFile('карта смыслов.pdf', 'application/pdf')).toBe(false)
    expect(isMediaFile('videoanalytics.xlsx', '')).toBe(false)
    expect(isMediaFile('IMG_9160.PNG', 'image/png')).toBe(false)
  })
  it('порог прямой загрузки ниже потолка Vercel 4,5 МБ, лимит 20 МБ', () => {
    expect(DIRECT_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024)
    expect(MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024)
  })
  it('диалог: медиа/большие файлы отсекаются до отправки, большие идут по подписанной ссылке', () => {
    const c = read('components/projects/KnowledgePageClient.tsx')
    expect(c).toContain('isMediaFile(f.name, f.type)')
    expect(c).toContain("fetch('/api/upload/url'")
    expect(c).toContain("uploadToSignedUrl(u.path, u.token, item.file)")
    expect(c).toContain("fd.append('storagePath', u.path)")
    expect(c).toContain('res.status === 413')
  })
  it('роут ссылки: проверка доступа к проекту, медиа и размер отбиваются; /api/upload принимает только свой префикс', () => {
    const u = read('app/api/upload/url/route.ts')
    expect(u).toContain("requireProjectAccess(supabase, projectId, user.id, 'editor')")
    expect(u).toContain("from('materials').createSignedUploadUrl(path)")
    expect(u).toContain('MEDIA_NOT_HERE')
    const r = read('app/api/upload/route.ts')
    expect(r).toContain("storagePath.startsWith(`projects/${projectId}/`)")
    expect(r).toContain("storagePath.includes('..')")
    expect(r).toContain("from('materials').download(storagePath)")
    expect(r).toContain('isMediaFile(file.name, file.type)')
    expect(MEDIA_NOT_HERE).toMatch(/Исследование/)
  })
})

describe('AI-правка без изменений = отказ, не «Правка применена»', () => {
  const car = { cover: { headline: 'A', subheadline: 'B' }, slides: [{ headline: 'S1', body: 'b1' }, { headline: 'S2', body: 'b2' }], last_slide: { text: 't', action: 'a' } }
  it('нормализация игнорирует пробелы, ловит любое изменение текста', () => {
    const same = JSON.parse(JSON.stringify(car)); same.slides[0].body = '  b1 '
    expect(isNoopEdit(normalizeCarousel(car), normalizeCarousel(same))).toBe(true)
    const changed = JSON.parse(JSON.stringify(car)); changed.slides[1].headline = 'Тест правки'
    expect(isNoopEdit(normalizeCarousel(car), normalizeCarousel(changed))).toBe(false)
    const lastChanged = JSON.parse(JSON.stringify(car)); lastChanged.last_slide.action = 'Пиши СОН'
    expect(isNoopEdit(normalizeCarousel(car), normalizeCarousel(lastChanged))).toBe(false)
    const fr = [{ headline: 'h', body: 'b', cta: 'c', position: 'top' }]
    expect(isNoopEdit(normalizeStories(fr), normalizeStories([{ ...fr[0], body: 'b ' }]))).toBe(true)
    expect(isNoopEdit(normalizeStories(fr), normalizeStories([{ ...fr[0], plate: true }]))).toBe(false)
  })
  it('оба роута: страж стоит перед ответом и пишет инструкцию в журнал', () => {
    for (const p of ['app/api/ai/edit-carousel/route.ts', 'app/api/ai/edit-stories/route.ts']) {
      const s = read(p)
      const iGuard = s.indexOf('isNoopEdit(')
      const iOk = s.indexOf(p.includes('carousel') ? 'return NextResponse.json({ carousel: out })' : 'return NextResponse.json({ stories: out })')
      expect(iGuard, p).toBeGreaterThan(0)
      expect(iGuard, p).toBeLessThan(iOk)
      expect(s, p).toContain("code: 'noop_edit' }, { status: 422 }")
      expect(s, p).toContain('instruction: instruction.slice(0, 300)')
    }
    expect(NOOP_EDIT_MESSAGE).toMatch(/номер слайда/)
  })
})
