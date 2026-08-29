// Возврат на исходную страницу после входа/регистрации (?next=).
//
// Зачем: воронка Августы (29.08) — она раздаёт ссылку amaproduct.com/blog-audit,
// незарегистрированный человек попадает на логин, регистрируется и ДОЛЖЕН
// вернуться на диагностику, а не на дашборд (иначе цель визита теряется).
// Механизм общий: middleware кладёт ?next= в редирект на логин, страницы
// логина/регистрации проносят его через все свои пути (пароль, Google-колбэк,
// код из письма), /auth/callback уже умеет next.
//
// Безопасность: принимаем ТОЛЬКО внутренние пути — абсолютные URL и
// протокол-относительные («//evil.com») отбрасываются, чтобы ?next= нельзя
// было использовать как open redirect.
export const DEFAULT_AFTER_AUTH = '/dashboard'

export function safeNextPath(raw: string | null | undefined): string {
  const v = (raw || '').trim()
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('://') || v.includes('\\')) {
    return DEFAULT_AFTER_AUTH
  }
  return v
}

// Дописать ?next= к внутренней ссылке (логин ↔ регистрация), не таща дефолт.
export function withNext(href: string, next: string): string {
  if (!next || next === DEFAULT_AFTER_AUTH) return href
  return `${href}${href.includes('?') ? '&' : '?'}next=${encodeURIComponent(next)}`
}
