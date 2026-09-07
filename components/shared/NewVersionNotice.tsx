'use client'

import { useEffect, useState } from 'react'

// «Вышла новая версия — обнови страницу».
//
// Евгения 07.09: ошибки 09:12:54 и 09:15:03 UTC совпали секунда в секунду с
// выкладками на Vercel. Старая вкладка после деплоя не может догрузить чанки
// старой сборки (ChunkLoadError: Failed to load chunk …) — на Hobby/без
// Skew Protection Vercel старые ассеты не хранит. Клиенту это выглядело как
// «Ошибка» без объяснения.
//
// Две половины класса:
//  1) первый раз — тихо перезагружаем страницу сами (адрес тот же, черновики
//     чата живут в localStorage); чтобы не зациклиться, отметка в sessionStorage
//     на 2 минуты;
//  2) если чанк не грузится и после перезагрузки (сеть) — показываем плашку с
//     кнопкой, а не молчим.
// Ошибки рендера (lazy-компонент из старой сборки) ловит error.tsx дашборда —
// тот же текст, та же кнопка.

export const CHUNK_ERROR_RE = /ChunkLoadError|Loading chunk|Failed to load chunk|Importing a module script failed|dynamically imported module|Failed to fetch dynamically imported/i

const RELOAD_KEY = 'ama_reload_for_new_version'
const RELOAD_WINDOW_MS = 2 * 60 * 1000

// true → перезагрузка уже была недавно, второй раз не крутим
export function shouldShowInsteadOfReload(now = Date.now(), read: () => string | null = () => sessionStorage.getItem(RELOAD_KEY)): boolean {
  try {
    const last = Number(read() || 0)
    return Number.isFinite(last) && last > 0 && now - last < RELOAD_WINDOW_MS
  } catch { return true }
}

export function NewVersionNotice() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onChunkError = () => {
      if (shouldShowInsteadOfReload()) { setShow(true); return }
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* storage blocked — тогда просто плашка */ setShow(true); return }
      window.location.reload()
    }
    const onError = (e: ErrorEvent) => {
      const msg = `${e.error?.name || ''} ${e.message || ''} ${e.error?.message || ''}`
      if (CHUNK_ERROR_RE.test(msg)) onChunkError()
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { name?: string; message?: string } | undefined
      const msg = `${r?.name || ''} ${r?.message || String(r ?? '')}`
      if (CHUNK_ERROR_RE.test(msg)) onChunkError()
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  if (!show) return null

  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[100] flex justify-center p-3 pointer-events-none">
      <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-100">
        <span>Вышла новая версия AVA — чтобы всё работало, обнови страницу.</span>
        <button type="button" onClick={() => window.location.reload()}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600">
          Обновить
        </button>
      </div>
    </div>
  )
}
