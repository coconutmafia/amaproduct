// User-facing error copy.
//
// Tester feedback (7 июля): raw technical error text (Postgres/RLS dumps,
// `Failed to fetch`, stack fragments) makes users think THEY filled something
// wrong. This module maps an error to a message that is either
//   (a) genuinely user-actionable — shown verbatim, or
//   (b) technical/opaque — replaced with a clear "it's on our side" message.
//
// Heuristic: our own API routes answer users in Russian, while raw exceptions
// from Postgres/Supabase/fetch/JS are in English (Latin). So a Cyrillic message
// is treated as user-facing copy and passes through; a Latin-only or otherwise
// technical message is hidden behind a reassuring generic message.
//
// Pure and client-safe — no server-only imports. See tests/smoke/friendly-error.test.ts.

export const SERVICE_ERROR_MESSAGE =
  'Упс, ошибка сервиса — это на нашей стороне, не в твоих данных. Скоро починим, попробуй ещё раз чуть позже.'

const CYRILLIC = /[а-яё]/i

// Technical fragments that must never reach the user, even when some Cyrillic
// happens to surround them (e.g. a server 500 that echoes a Postgres error).
const TECHNICAL =
  /(row-level security|violates|duplicate key|null value|permission denied|\bJWT\b|PGRST|foreign key|Failed to fetch|fetch failed|NetworkError|ECONN|ETIMEDOUT|Unexpected token|is not defined|is not a function|Cannot read propert|undefined is not|relation ".*" does not|column .* does not|500 Internal|50[23] )/i

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  return ''
}

/**
 * Map an error to a message safe to show the user.
 * @param fallback shown when the underlying message is technical/opaque or empty.
 *   Defaults to the generic "it's on our side" copy; pass a specific friendly
 *   Russian fallback (e.g. 'Не удалось сохранить серию') where one fits better.
 */
// Domain errors raised by DB triggers. Their text is Latin, so the rules below
// would hide them behind the generic «это на нашей стороне» — but these are NOT
// our fault and the user CAN act on them, so translate them explicitly.
const DOMAIN_MAP: Array<[RegExp, string]> = [
  [/project_limit_reached/i, 'На твоём тарифе закончились проекты. Выбери тариф выше на странице «Тарифы» — и создавай больше.'],
]

export function friendlyError(error: unknown, fallback: string = SERVICE_ERROR_MESSAGE): string {
  const msg = extractMessage(error).trim()
  if (!msg) return fallback
  for (const [re, text] of DOMAIN_MAP) if (re.test(msg)) return text
  if (TECHNICAL.test(msg)) return fallback
  // Russian text is our own user-facing copy (validation, limits, permissions,
  // session-expired) — show it as-is.
  if (CYRILLIC.test(msg)) return msg
  // Latin-only message = raw library/exception text → hide behind the fallback.
  return fallback
}

// Common Supabase Auth error strings (English) → user-actionable Russian copy.
// Auth errors ARE the user's to act on, so we translate rather than genericize.
const AUTH_MAP: Array<[RegExp, string]> = [
  [/invalid login credentials/i, 'Неверный email или пароль'],
  [/email not confirmed/i, 'Подтверди email — мы отправили письмо со ссылкой для входа'],
  [/user already registered|already been registered/i, 'Пользователь с таким email уже зарегистрирован'],
  [/password should be at least/i, 'Пароль должен быть не короче 6 символов'],
  [/should be different from the old password/i, 'Новый пароль должен отличаться от старого'],
  [/unable to validate email address|invalid format/i, 'Неверный формат email'],
  [/email rate limit exceeded/i, 'Слишком много писем за короткое время. Подожди немного и попробуй снова'],
  [/for security purposes|after \d+ seconds|over_email_send_rate_limit/i, 'Слишком частые попытки. Подожди немного и попробуй снова'],
  [/signups not allowed|signup is disabled/i, 'Регистрация временно недоступна'],
  [/token has expired|invalid or has expired|otp_expired/i, 'Ссылка устарела. Запроси новую и попробуй снова'],
]

/**
 * Map a Supabase auth error to Russian user-facing copy.
 * Falls through friendlyError for unknown messages (Cyrillic passes, Latin →
 * a generic auth fallback rather than the service-error copy).
 */
export function authErrorMessage(error: unknown): string {
  const msg = extractMessage(error).trim()
  for (const [re, ru] of AUTH_MAP) {
    if (re.test(msg)) return ru
  }
  return friendlyError(error, 'Не удалось выполнить вход. Проверь данные и попробуй ещё раз')
}
