'use client'

import { useEffect } from 'react'
import { CHUNK_ERROR_RE } from '@/components/shared/NewVersionNotice'

// Граница ошибок дашборда. До 07.09 её не было: ошибка рендера (например,
// lazy-компонент старой сборки после деплоя — ChunkLoadError) показывала
// дефолтный экран Next без объяснения. Здесь две ветки: «вышла новая версия —
// обнови» и общая «упс, попробуй ещё раз».
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const newVersion = CHUNK_ERROR_RE.test(`${error?.name || ''} ${error?.message || ''}`)

  useEffect(() => {
    // Ошибки рендера не проходят через window.onerror — репортим сами тем же
    // приёмником, что и instrumentation-client (чтобы /admin/errors их видел).
    try {
      fetch('/api/client-error', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ kind: error?.name || 'RenderError', message: String(error?.message || '').slice(0, 500), stack: String(error?.stack || '').slice(0, 3000), url: location.href, ua: navigator.userAgent }),
      }).catch(() => {})
    } catch { /* never break the boundary */ }
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        {newVersion ? (
          <>
            <h2 className="text-lg font-semibold">Вышла новая версия AVA</h2>
            <p className="mt-2 text-sm text-muted-foreground">Эта вкладка держит старую. Обнови страницу — и всё заработает, черновики сохранены.</p>
            <button type="button" onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Обновить страницу
            </button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Упс, что-то сломалось</h2>
            <p className="mt-2 text-sm text-muted-foreground">Это на нашей стороне, не в твоих данных. Попробуй ещё раз, а если повторится — обнови страницу.</p>
            <div className="mt-4 flex justify-center gap-2">
              <button type="button" onClick={() => reset()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                Попробовать ещё раз
              </button>
              <button type="button" onClick={() => window.location.reload()}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
                Обновить страницу
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
