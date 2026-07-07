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
