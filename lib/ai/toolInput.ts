// Нормализация `input` у tool_use-ответов Claude.
//
// Класс дефекта известен в репо по плану прогрева и брифу недели: модель
// ВРЕМЕНАМИ сериализует вложенный массив/объект как JSON-СТРОКУ вместо родной
// структуры. Замерено 06.09 на «Таблице исследования» Стаси: 2 прогона из 3 на
// одном и том же батче вернули respondents строкой на 19–23 тыс. знаков —
// валидная таблица, которую код объявлял «AI не нашёл участников» (9 джобов
// подряд ушли в ошибку). До этого лечение жило семью локальными копиями
// toArray в роутах, а самый дорогой вызов (table1) его не имел.
// Теперь — одно место для всех потребителей tool_use (страж: tool-input.test.ts).

export function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v
  let s = v.trim()
  if (!s) return v
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) s = fence[1].trim()
  if (!(s.startsWith('[') || s.startsWith('{'))) return v
  try { return JSON.parse(s) } catch { return v }
}

/** Массив из значения, которое модель могла отдать строкой JSON. Иначе []. */
export function toArray(v: unknown): unknown[] {
  const p = parseMaybeJson(v)
  return Array.isArray(p) ? p : []
}

/** Объект из значения, которое модель могла отдать строкой JSON. Иначе null. */
export function toRecord(v: unknown): Record<string, unknown> | null {
  const p = parseMaybeJson(v)
  return p !== null && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
}

/** Список строк: массив, JSON-строка массива или одиночная строка → [строка]. */
export function toStringList(v: unknown): string[] {
  const p = parseMaybeJson(v)
  if (Array.isArray(p)) return p.map((x) => String(x ?? '').trim()).filter(Boolean)
  if (typeof p === 'string' && p.trim()) return [p.trim()]
  return []
}
