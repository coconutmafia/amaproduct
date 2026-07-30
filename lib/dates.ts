// Единая точка форматирования дат/времени для показа людям.
//
// ЗАЧЕМ ФИКСИРОВАННАЯ ЗОНА: SSR выполняется на Vercel в UTC, гидрация — в зоне
// браузера. toLocale*String без timeZone даёт РАЗНЫЕ строки на сервере и клиенте
// → React #418 (вживую на /projects 29–30 июля: updated_at 23:30 UTC — это
// «29.07.2026» в SSR-HTML и «30.07.2026» у клиента UTC+3). Продукт целиком
// ru-RU, аудитория — RU/UA (UTC+3), поэтому все даты показываем по Москве.
// Не форматируй даты напрямую через toLocale*String — упадёт тест-страж
// tests/smoke/hydration-safe-dates.test.ts.
export const DISPLAY_TZ = 'Europe/Moscow'

type DateInput = string | number | Date

/** Дата без времени: «30.07.2026» (или свои opts: { day: 'numeric', month: 'long' } → «30 июля»). */
export function fmtDateRu(d: DateInput, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(d).toLocaleDateString('ru-RU', { timeZone: DISPLAY_TZ, ...opts })
}

/** Дата со временем: «30.07.2026, 14:30» (opts переопределяют формат). */
export function fmtDateTimeRu(d: DateInput, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(d).toLocaleString('ru-RU', { timeZone: DISPLAY_TZ, ...opts })
}

// ── Локальная зона ЗРИТЕЛЯ ─────────────────────────────────────────────────
// Безопасно ТОЛЬКО там, где строка гарантированно не попадает в SSR-HTML:
// данные, пришедшие после маунта (useEffect-fetch), обработчики кликов,
// состояние, заполняемое пользователем. Для данных, отрендеренных при SSR
// (пропсы с серверной страницы), — компонент <LocalDate> (components/ui).
// Вызов в SSR-рендере вернёт зону СЕРВЕРА (UTC на Vercel) и воскресит #418.

/** Дата в зоне зрителя. См. предупреждение выше. */
export function fmtDateLocalRu(d: DateInput, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(d).toLocaleDateString('ru-RU', opts)
}

/** Дата+время в зоне зрителя. См. предупреждение выше. */
export function fmtDateTimeLocalRu(d: DateInput, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(d).toLocaleString('ru-RU', opts)
}
