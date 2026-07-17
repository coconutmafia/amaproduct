import { describe, it, expect } from 'vitest'
import { isDefinitelyNotMedia, normalizeExt, NOT_MEDIA_MESSAGE } from '@/lib/media/notMedia'

// Регрессия 17 июля: клиент на Pro загрузил в расшифровку интервью фотографию
// (.png с телефона), файл доехал до ffmpeg и тот упал, показав человеку свою
// командную строку. Проверяем ровно ту границу, которую теперь держим.
describe('isDefinitelyNotMedia', () => {
  it('режет фото и документы — тот самый случай', () => {
    expect(isDefinitelyNotMedia({ ext: 'png' })).toBe(true)
    expect(isDefinitelyNotMedia({ ext: 'jpg' })).toBe(true)
    expect(isDefinitelyNotMedia({ ext: 'heic' })).toBe(true)   // фото с айфона
    expect(isDefinitelyNotMedia({ ext: 'pdf' })).toBe(true)
    expect(isDefinitelyNotMedia({ ext: 'docx' })).toBe(true)
    expect(isDefinitelyNotMedia({ ext: 'zip' })).toBe(true)
  })

  it('пропускает аудио и видео', () => {
    for (const ext of ['mp3', 'm4a', 'wav', 'ogg', 'opus', 'flac', 'aac', 'amr']) {
      expect(isDefinitelyNotMedia({ ext })).toBe(false)
    }
    // звук тянется и из видеоконтейнеров — их резать нельзя
    for (const ext of ['mp4', 'mov', 'webm', 'mkv', 'avi', '3gp']) {
      expect(isDefinitelyNotMedia({ ext })).toBe(false)
    }
  })

  it('MIME важнее расширения — файл из галереи телефона', () => {
    expect(isDefinitelyNotMedia({ ext: '', mime: 'image/png' })).toBe(true)
    expect(isDefinitelyNotMedia({ ext: 'png', mime: 'audio/mpeg' })).toBe(false)
    expect(isDefinitelyNotMedia({ ext: '1', mime: 'video/quicktime' })).toBe(false)
  })

  it('НЕ режет файл без расширения — заглушка из iCloud должна грузиться', () => {
    // у неё не читается даже имя, код подставляет «файл 1» → ext выходит «1»
    expect(isDefinitelyNotMedia({ ext: '1' })).toBe(false)
    expect(isDefinitelyNotMedia({ ext: '' })).toBe(false)
    expect(isDefinitelyNotMedia({ ext: null, mime: null })).toBe(false)
    // неизвестный экзотический формат тоже пропускаем — решает ffmpeg
    expect(isDefinitelyNotMedia({ ext: 'caf' })).toBe(false)
  })

  it('расширение нормализуется так же, как в upload-url', () => {
    expect(normalizeExt('.PNG')).toBe('png')
    expect(normalizeExt('M4A')).toBe('m4a')
    expect(isDefinitelyNotMedia({ ext: '.PNG' })).toBe(true)
  })

  it('сообщение человеческое: без ffmpeg, путей и латиницы-мусора', () => {
    expect(NOT_MEDIA_MESSAGE).toMatch(/[а-яё]/i)
    expect(NOT_MEDIA_MESSAGE).not.toMatch(/ffmpeg|\/var\/task|Command failed/i)
  })
})
