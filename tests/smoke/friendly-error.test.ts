import { describe, it, expect } from 'vitest'
import { friendlyError, authErrorMessage, SERVICE_ERROR_MESSAGE } from '@/lib/friendlyError'

describe('friendlyError', () => {
  it('hides raw Postgres/RLS technical text behind the service message', () => {
    expect(friendlyError(new Error('new row violates row-level security policy for table "projects"')))
      .toBe(SERVICE_ERROR_MESSAGE)
    expect(friendlyError(new Error('duplicate key value violates unique constraint')))
      .toBe(SERVICE_ERROR_MESSAGE)
  })

  it('hides Latin-only exception/library text', () => {
    expect(friendlyError(new Error('Failed to fetch'))).toBe(SERVICE_ERROR_MESSAGE)
    expect(friendlyError(new Error('Unauthorized'))).toBe(SERVICE_ERROR_MESSAGE)
    expect(friendlyError(new Error('Cannot read properties of undefined'))).toBe(SERVICE_ERROR_MESSAGE)
  })

  // Регрессия 17 июля: русский префикс «Ошибка расшифровки:» проходил эвристику
  // «есть кириллица → это наш текст» и протаскивал за собой всю командную строку
  // ffmpeg вместе с /var/task/node_modules — клиент увидел это на экране.
  it('hides a technical tail even behind a Russian prefix', () => {
    const raw = 'Ошибка расшифровки: ffmpeg: Command failed: /var/task/node_modules/ffmpeg-static/ffmpeg -y -i /tmp/tr-1784278403273-in.png -t 600 -vn -ac 1 -ar 16000 -f mp3'
    const out = friendlyError(raw, 'Не удалось обработать файл.')
    expect(out).toBe('Не удалось обработать файл.')
    expect(out).not.toMatch(/ffmpeg|\/var\/task|node_modules|\/tmp\//)
  })

  it('shows Russian user-facing copy verbatim', () => {
    expect(friendlyError(new Error('Сессия истекла, войди заново'))).toBe('Сессия истекла, войди заново')
    expect(friendlyError(new Error('projectId и rule обязательны'))).toBe('projectId и rule обязательны')
    expect(friendlyError(new Error('Доступно только редакторам — у тебя доступ на просмотр')))
      .toBe('Доступно только редакторам — у тебя доступ на просмотр')
  })

  it('uses the provided fallback for opaque/empty errors', () => {
    expect(friendlyError(new Error('TypeError x'), 'Не удалось сохранить серию')).toBe('Не удалось сохранить серию')
    expect(friendlyError(null, 'Не удалось загрузить')).toBe('Не удалось загрузить')
    expect(friendlyError(undefined)).toBe(SERVICE_ERROR_MESSAGE)
  })

  it('hides technical text even when some Cyrillic surrounds it', () => {
    expect(friendlyError(new Error('Ошибка: new row violates row-level security policy')))
      .toBe(SERVICE_ERROR_MESSAGE)
  })

  it('accepts plain strings and objects with a message field', () => {
    expect(friendlyError('Не удалось')).toBe('Не удалось')
    expect(friendlyError({ message: 'Failed to fetch' })).toBe(SERVICE_ERROR_MESSAGE)
  })
})

describe('authErrorMessage', () => {
  it('translates common Supabase auth errors to Russian', () => {
    expect(authErrorMessage(new Error('Invalid login credentials'))).toBe('Неверный email или пароль')
    expect(authErrorMessage(new Error('User already registered'))).toBe('Пользователь с таким email уже зарегистрирован')
    expect(authErrorMessage(new Error('Email not confirmed')))
      .toBe('Подтверди email — мы отправили письмо со ссылкой для входа')
    expect(authErrorMessage(new Error('Password should be at least 6 characters')))
      .toBe('Пароль должен быть не короче 6 символов')
  })

  it('falls back to a generic auth message for unknown Latin errors', () => {
    expect(authErrorMessage(new Error('some weird internal thing')))
      .toBe('Не удалось выполнить вход. Проверь данные и попробуй ещё раз')
  })

  it('passes Russian auth copy through', () => {
    expect(authErrorMessage(new Error('Слишком много попыток'))).toBe('Слишком много попыток')
  })
})

// Ошибка триггера лимита проектов (миграция 035) приходит латиницей — по общему
// правилу её спрятало бы за «это на нашей стороне», хотя это не сбой, а тариф.
describe('project limit (DB trigger) → человеческий текст', () => {
  it('переводит project_limit_reached вместо generic-фолбэка', () => {
    const out = friendlyError(new Error('project_limit_reached: 1 of 1'))
    expect(out).toMatch(/тариф/i)
    expect(out).not.toMatch(/на нашей стороне/i)
  })
})
