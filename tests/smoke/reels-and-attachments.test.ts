import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Жалобы клиента 26.08 по разделу «Тренды» и чату. Каждая — про связку, которая
// либо есть, либо молча отсутствует; тесты держат связки на месте.
const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('залетевшие рилзы доходят до AI', () => {
  // Корень жалобы «загрузила рилзы — ассистент их не видит»: viral_reels читали
  // план прогрева, брифы и тренды, но НЕ buildRAGContext, через который ходят
  // чат, AI-правка контент-плана и генерация.
  it('buildRAGContext читает viral_reels', () => {
    const rag = read('lib/ai/rag.ts')
    expect(rag, 'нет запроса к viral_reels').toMatch(/from\('viral_reels'\)/)
    expect(rag, 'слой не отдаётся наружу').toMatch(/viralReels/)
    expect(rag, 'рилзы обязаны быть в СТАБИЛЬНОЙ части (иначе ломают кэш)')
      .toMatch(/if \(!opts\?\.matchesOnly\)[\s\S]{0,200}viral_reels/)
  })

  it('системный промпт показывает их отдельной секцией со списком', () => {
    const sys = read('lib/ai/prompts/system.ts')
    expect(sys).toMatch(/ЗАЛЕТЕВШИЕ РИЛЗЫ/)
    expect(sys, 'список должен быть нумерованным — на них ссылаются по номеру').toMatch(/reels\.map\(\(r, i\)/)
  })

  it('ассистент знает, куда девать присланную ссылку, вместо «нет доступа в интернет»', () => {
    const chat = read('app/api/ai/chat/route.ts')
    expect(chat).toMatch(/ССЫЛКИ/)
    expect(chat, 'нужен конкретный маршрут, а не отказ').toMatch(/Тренды/)
    expect(chat).toMatch(/Добавить и разобрать/)
  })

  it('список рилзов сворачивается и ищется (76 штук нельзя листать целиком)', () => {
    const ui = read('components/projects/ViralReelsManager.tsx')
    expect(ui, 'нет сворачивания').toMatch(/collapsed/)
    expect(ui, 'нет счётчика').toMatch(/Загружено: \{reels\.length\}/)
    expect(ui, 'нет поиска').toMatch(/Поиск по формату/)
  })
})

describe('вложения в чат', () => {
  it('композер умеет прикреплять фото и ужимает их до отправки', () => {
    const c = read('components/ui/ChatComposer.tsx')
    expect(c, 'нет выбора файла').toMatch(/type="file"/)
    expect(c, 'фото обязано ужиматься — иначе не влезет в тело запроса').toMatch(/MAX_EDGE/)
    expect(c, 'видео должно объясняться, а не молча игнорироваться').toMatch(/video\//)
  })

  it('сервер принимает ТОЛЬКО data-URL картинки (не ходит по чужим адресам)', () => {
    const chat = read('app/api/ai/chat/route.ts')
    expect(chat).toMatch(/imageBlocks/)
    expect(chat, 'нужен строгий разбор data:image/...;base64').toMatch(/\^data:\(image/)
    expect(chat, 'нет потолка размера картинки').toMatch(/7_000_000/)
  })

  it('картинки идут ПЕРЕД текстом в последнем сообщении', () => {
    const chat = read('app/api/ai/chat/route.ts')
    expect(chat).toMatch(/\.\.\.imgs,\s*\n\s*\{ type: 'text'/)
  })
})
