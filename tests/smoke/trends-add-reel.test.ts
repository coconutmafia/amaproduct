import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isReelUrl, findReelUrl } from '@/lib/reels/isReelUrl'
import { scriptPrompt } from '@/components/projects/ViralReelsManager'

// Августа 06.09: «Кнопка добавить не работает. Хочу чтобы он тренд
// проанализировал и мне написал сценарий». Вставила ссылку на рилз в форму
// «Добавить свой тренд», описание пустое — кнопка молча серая; блок
// «Залетевшие рилз» лежал ниже восьми трендов. Связки, которые держим:
// ссылка → разбор той же кнопкой; кнопка объясняет, чего не хватает;
// блок рилзов над списками; от разбора к сценарию — один тап.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('lib/reels/isReelUrl', () => {
  it('принимает формы ссылок, которыми делятся из Instagram', () => {
    for (const u of [
      'https://www.instagram.com/reel/DceN_FTJbO0/?igsh=abc',
      'https://instagram.com/reels/DceN_FTJbO0',
      'instagram.com/p/Cxyz123/',
      'https://www.instagram.com/augusta.vasilik/reel/DceN_FTJbO0/',
      'https://www.instagram.com/tv/Cxyz123/',
    ]) expect(isReelUrl(u), u).toBe(true)
  })
  it('не принимает профиль, сторис и чужие домены', () => {
    for (const u of ['https://www.instagram.com/augusta.vasilik/', 'https://www.instagram.com/stories/user/123/', 'https://youtube.com/reel/abc', '']) {
      expect(isReelUrl(u), u).toBe(false)
    }
  })
  it('findReelUrl достаёт ссылку из любого поля и нормализует до https', () => {
    expect(findReelUrl('Тренд с мемами', '', 'instagram.com/reel/DceN_FTJbO0/')).toBe('https://instagram.com/reel/DceN_FTJbO0/')
    expect(findReelUrl('см. https://www.instagram.com/reel/AbC-12_3/?utm=1 обязательно')).toBe('https://www.instagram.com/reel/AbC-12_3/?utm=1')
    expect(findReelUrl('просто текст', '')).toBeNull()
  })
})

describe('форма «Добавить свой тренд»', () => {
  const page = read('app/(dashboard)/projects/[id]/trends/page.tsx')
  it('кнопка не бывает молча серой: объясняет, чего не хватает', () => {
    expect(page).not.toContain("disabled={!title.trim() || !description.trim() || saving}")
    expect(page).toContain('disabled={saving}')
    expect(page).toContain('Опиши в двух словах')
    expect(page).toContain('titleRef.current?.focus()')
  })
  it('ссылка на рилз без описания → «Разобрать рилз» тем же фоновым джобом', () => {
    expect(page).toContain('findReelUrl(example, description, title)')
    expect(page).toContain("fetch('/api/viral-reels'")
    expect(page).toContain('Разобрать рилз')
    expect(page).toContain('pollJob(startBody.jobId)')
    expect(page).toContain('refreshKey={reelsRefresh}')
  })
  it('блок «Залетевшие рилз» стоит над «Мои тренды»', () => {
    expect(page.indexOf('Залетевшие рилз — референсы')).toBeLessThan(page.indexOf('Мои тренды <span'))
  })
})

describe('от разбора к сценарию', () => {
  it('у каждого разобранного рилза проекта есть «Сценарий по этому рилзу» → ассистент с готовым запросом', () => {
    const ui = read('components/projects/ViralReelsManager.tsx')
    expect(ui).toContain('Сценарий по этому рилзу')
    expect(ui).toContain('/assistant?prompt=${encodeURIComponent(scriptPrompt(r))}')
    expect(ui).toContain('isReelUrl(v)')
    const p = scriptPrompt({ reel_type: 'Разбор с мемными вставками', username: 'someone', analysis: 'Хук на первой секунде, дальше три вставки' })
    expect(p).toContain('в моём голосе')
    expect(p).toContain('@someone')
    expect(p).toContain('Хук на первой секунде')
  })
  it('ассистент авто-отправляет ?prompt= при открытии', () => {
    const a = read('app/(dashboard)/projects/[id]/assistant/page.tsx')
    expect(a).toContain("sp.get('prompt')")
    expect(a).toMatch(/setTimeout\(\(\) => send\(seed\)/)
  })
  it('роут рилзов принимает те же формы ссылок, что и форма', () => {
    expect(read('app/api/viral-reels/route.ts')).toContain('isReelUrl(url)')
  })
})
