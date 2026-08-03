import { describe, it, expect } from 'vitest'
import { sanitizeTranscribeError } from '@/lib/jobs/transcribeErrors'

// Санитайзер jobs.error расшифровки: клиент видит только честный русский текст,
// retryable решает судьбу файла в хранилище (см. runTranscribeJob).

describe('sanitizeTranscribeError', () => {
  it('429/кредиты OpenAI → retryable, без хвоста провайдера (регрессия 31 июля)', () => {
    const raw = '429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.'
    const out = sanitizeTranscribeError(raw)
    expect(out.retryable).toBe(true)
    expect(out.userMessage).not.toMatch(/credits|openai|billing|429/i)
    expect(out.userMessage).toMatch(/[а-яё]/i)
  })

  it('перегруз/сеть/5xx → retryable', () => {
    expect(sanitizeTranscribeError('Anthropic overloaded_error').retryable).toBe(true)
    expect(sanitizeTranscribeError('fetch failed').retryable).toBe(true)
    expect(sanitizeTranscribeError('Request timed out').retryable).toBe(true)
    expect(sanitizeTranscribeError('503 Service Unavailable').retryable).toBe(true)
  })

  it('ffmpeg/битый файл → НЕ retryable, командная строка спрятана (регрессия 17 июля)', () => {
    const raw = 'ffmpeg: Command failed: /var/task/node_modules/ffmpeg-static/ffmpeg -y -i /tmp/tr-123-in.gsheet -t 600'
    const out = sanitizeTranscribeError(raw)
    expect(out.retryable).toBe(false)
    expect(out.userMessage).not.toMatch(/ffmpeg|\/var\/task|\/tmp\/|node_modules/)
    expect(out.userMessage).toMatch(/[а-яё]/i)
  })

  it('наши русские тексты без хвоста проходят как есть', () => {
    const empty = 'Пустой файл — возможно, он не докачался из iCloud. Открой его в «Файлах» и попробуй снова.'
    const out = sanitizeTranscribeError(empty)
    expect(out.userMessage).toBe(empty)
    expect(out.retryable).toBe(false) // «Пустой файл» повтором не лечится
  })

  it('русский префикс с латинским хвостом НЕ проходит как есть', () => {
    const raw = 'Ошибка расшифровки: 429 You have no credits remaining. Add credits at https://platform.openai.com/…'
    const out = sanitizeTranscribeError(raw)
    expect(out.userMessage).not.toMatch(/openai|credits/i)
  })

  it('неизвестная причина → generic + retryable (файл сохраняем)', () => {
    const out = sanitizeTranscribeError('weird internal thing')
    expect(out.retryable).toBe(true)
    expect(out.userMessage).toMatch(/[а-яё]/i)
  })

  it('пустая строка не роняет и даёт текст', () => {
    expect(sanitizeTranscribeError('').userMessage.length).toBeGreaterThan(10)
    expect(sanitizeTranscribeError(null).userMessage.length).toBeGreaterThan(10)
  })
})
