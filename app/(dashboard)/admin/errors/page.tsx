'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw, Trash2, AlertTriangle, ChevronDown } from 'lucide-react'

interface ErrorEvent {
  id: string
  level: string
  source: string | null
  route: string | null
  message: string
  stack: string | null
  context: Record<string, unknown> | null
  user_id: string | null
  created_at: string
}

const LEVEL_COLOR: Record<string, string> = {
  error: 'bg-red-500/15 text-red-600 border-red-500/25',
  warning: 'bg-amber-500/15 text-amber-600 border-amber-500/25',
  info: 'bg-blue-500/15 text-blue-600 border-blue-500/25',
}

export default function AdminErrorsPage() {
  const [events, setEvents] = useState<ErrorEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/errors?limit=200')
      if (res.status === 403) { toast.error('Только для администратора'); setLoading(false); return }
      const data = await res.json() as { events: ErrorEvent[]; needsMigration?: boolean }
      setEvents(data.events || []); setNeedsMigration(!!data.needsMigration)
    } catch { toast.error('Ошибка загрузки') }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const clearAll = async () => {
    if (!confirm('Очистить весь лог ошибок?')) return
    setClearing(true)
    try {
      const res = await fetch('/api/admin/errors', { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setEvents([]); toast.success('Лог очищен')
    } catch { toast.error('Не удалось очистить') }
    setClearing(false)
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Ошибки</h1>
          <span className="text-sm text-muted-foreground">{events.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="p-2 rounded-lg hover:bg-secondary text-muted-foreground" title="Обновить">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={clearAll} disabled={clearing || events.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-destructive hover:bg-destructive/10">
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Очистить
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Серверные, фоновые, cron и клиентские ошибки за последнее время. Свежие сверху. У клиентских в контексте — страница и браузер (UA).
      </p>

      {needsMigration && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          ⚠️ Таблица лога не создана. Примени миграцию <b>028_error_events.sql</b> в Supabase → SQL Editor.
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : events.length === 0 && !needsMigration ? (
        <p className="text-sm text-muted-foreground text-center py-10">Ошибок нет — чисто ✨</p>
      ) : (
        <div className="space-y-2">
          {events.map(e => (
            <div key={e.id} className="rounded-xl border border-border bg-card p-3 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${LEVEL_COLOR[e.level] || LEVEL_COLOR.error}`}>{e.level}</span>
                {e.source && <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{e.source}</span>}
                {e.route && <span className="text-[11px] font-mono text-muted-foreground truncate">{e.route}</span>}
                <span className="text-[11px] text-muted-foreground ml-auto">{new Date(e.created_at).toLocaleString('ru-RU')}</span>
              </div>
              <p className="mt-1.5 text-foreground break-words">{e.message}</p>
              {(e.stack || e.context) && (
                <button onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  <ChevronDown className={`h-3 w-3 transition-transform ${expanded === e.id ? 'rotate-180' : ''}`} /> детали
                </button>
              )}
              {expanded === e.id && (
                <div className="mt-2 space-y-2">
                  {e.stack && <pre className="text-[10px] bg-secondary/50 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">{e.stack}</pre>}
                  {e.context && Object.keys(e.context).length > 0 && (
                    <pre className="text-[10px] bg-secondary/50 rounded-lg p-2 overflow-x-auto">{JSON.stringify(e.context, null, 2)}</pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
