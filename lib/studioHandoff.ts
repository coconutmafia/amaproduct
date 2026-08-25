'use client'

// Handoff from an entry point (чат-ассистент, контент-план) into the unified
// content studio (/projects/[id]/create). The scenario text is far too long for
// a query string, so it travels through localStorage; the day/type context (if
// we started from a specific content-plan day) travels with it so the studio can
// bind the publication back to that day automatically (tester's «путь A»).

export interface StudioHandoff {
  format: 'post' | 'carousel' | 'stories' | 'reels'
  text: string
  /** set only when we came from a specific content-plan day (путь A) */
  day?: number
  phase?: string
}

const key = (projectId: string) => `ama_studio_handoff_${projectId}`

export function setStudioHandoff(projectId: string, data: StudioHandoff): void {
  try { localStorage.setItem(key(projectId), JSON.stringify(data)) } catch { /* ignore */ }
}

// ── Авто-сохранение сценария при «Оформить» (Марина, 25.08) ──────────────────
// Хендофф жил только в localStorage: вышла из оформления — утверждённый в чате
// сценарий пропадал («создала серию, нажала выйти — весь результат пропал»),
// а команда советовала неочевидный обход «сначала В Готовое, потом Оформить».
// Теперь «Оформить» САМ кладёт сценарий в «Готовое» (сервер) — потерять его,
// выйдя со страницы, больше нельзя. Сет — защита от дублей при повторных
// кликах в рамках сессии; упавший сейв не блокирует навигацию.
const autoSavedScripts = new Set<string>()

export function autoSaveScriptToLibrary(projectId: string, format: string, text: string): void {
  const sig = `${projectId}:${format}:${text.length}:${text.slice(0, 100)}`
  if (autoSavedScripts.has(sig)) return
  autoSavedScripts.add(sig)
  import('@/lib/saveContent')
    .then(({ saveToLibrary }) => saveToLibrary({ body: text, content_type: format, project_id: projectId }))
    .then(() => {
      void import('sonner').then(({ toast }) =>
        toast.success('Сценарий сохранён в «Готовое» — не потеряется, даже если выйдешь из оформления'))
    })
    .catch(() => { autoSavedScripts.delete(sig) /* повторный клик попробует снова */ })
}

/** Read once and clear — a refresh must not resurrect a stale draft. */
export function takeStudioHandoff(projectId: string): StudioHandoff | null {
  try {
    const raw = localStorage.getItem(key(projectId))
    if (!raw) return null
    localStorage.removeItem(key(projectId))
    const d = JSON.parse(raw) as StudioHandoff
    if (!d || typeof d.text !== 'string') return null
    if (d.format !== 'post' && d.format !== 'carousel' && d.format !== 'stories') return null
    return d
  } catch { return null }
}

/** Content-plan format keys → studio tabs. Reels have no visual studio. */
export function studioFormatFor(contentType: string): StudioHandoff['format'] | null {
  if (contentType === 'post') return 'post'
  if (contentType === 'carousel') return 'carousel'
  if (contentType === 'stories') return 'stories'
  if (contentType === 'reels') return 'reels' // сценарий рилза → вкладка монтажа
  return null
}
