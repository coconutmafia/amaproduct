// «Правка без изменений» — страж для AI-правок каруселей и сторис (08.09).
//
// Алиса и Светлана 08.09: «правки проигнорировал». Запросы доходили до модели
// (3 вызова edit-carousel, 1 edit-stories, все 200), сама правка на проде
// работает (проверено под QA-ботом: инструкции с номером слайда применяются
// за 6–10 с). Значит, модель вернула структуру БЕЗ изменений, а клиент честно
// перерисовал то же самое и написал «Правка применена». Теперь такое считаем
// отказом: роут отвечает 422 с подсказкой, как сформулировать, и пишет
// инструкцию в журнал — следующий разбор будет по факту, а не по догадкам.
// Модуль чистый (без server-only импортов) — им пользуются роуты и тесты.

type Dict = Record<string, unknown>
const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

export function normalizeCarousel(c: Dict | null | undefined): string {
  if (!c) return ''
  const cover = (c.cover ?? {}) as Dict
  const slides = Array.isArray(c.slides) ? (c.slides as Dict[]) : []
  const last = (c.last_slide ?? null) as Dict | null
  return JSON.stringify({
    cover: [s(cover.headline), s(cover.subheadline), s(cover.emoji)],
    slides: slides.map((sl) => [s(sl.headline), s(sl.body), s(sl.emoji)]),
    last: last ? [s(last.text), s(last.action)] : null,
  })
}

export function normalizeStories(frames: Dict[] | null | undefined): string {
  return JSON.stringify((frames ?? []).map((f) => [s(f.headline), s(f.body), s(f.cta), s(f.position), f.plate === true ? 'with' : f.plate === false ? 'without' : '']))
}

/** true — правка ничего не изменила (нормализованные тексты совпали). */
export function isNoopEdit(before: string, after: string): boolean {
  return before === after
}

export const NOOP_EDIT_MESSAGE =
  'Правка не изменила текст. Напиши конкретнее — номер слайда и что именно поменять, например: «на 3-м слайде заголовок: …» или «в финальном призыв: …».'
