'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2, Plus, Trash2, Film, Eye, Heart, MessageCircle, Sparkles } from 'lucide-react'
import { pollJob } from '@/lib/jobs/pollJob'

interface Reel {
  id: string
  source_url: string
  username: string | null
  reel_type: string | null
  analysis: string | null
  niches: string[] | null
  views: number | null
  likes: number | null
  comments: number | null
}

interface Props {
  scope: 'system' | 'project'
  projectId?: string
}

export function ViralReelsManager({ scope, projectId }: Props) {
  const [reels, setReels] = useState<Reel[]>([])
  const [loading, setLoading] = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [url, setUrl] = useState('')
  const [nichesInput, setNichesInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const qs = scope === 'system' ? 'scope=system' : `scope=project&projectId=${projectId}`
      const res = await fetch(`/api/viral-reels?${qs}`)
      if (res.status === 403) { toast.error('Нет доступа'); setLoading(false); return }
      const data = await res.json() as { reels: Reel[]; needsMigration?: boolean }
      setReels(data.reels || []); setNeedsMigration(!!data.needsMigration)
    } catch { toast.error('Ошибка загрузки') }
    setLoading(false)
  }, [scope, projectId])
  useEffect(() => { load() }, [load])

  const add = async () => {
    const v = url.trim()
    if (!/instagram\.com\/(reel|p|tv)\//.test(v)) { toast.error('Вставь ссылку на Instagram рилз'); return }
    setAdding(true)
    // Background job (roadmap #8 pattern) — the client just enqueues + polls,
    // so a locked/backgrounded phone doesn't lose the in-flight analysis.
    const t = toast.loading('Загружаю рилз…')
    try {
      const res = await fetch('/api/viral-reels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: v, scope, projectId,
          niches: scope === 'system' ? nichesInput.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        }),
      })
      const startBody = await res.json().catch(() => ({})) as { jobId?: string; error?: string }
      if (!res.ok || !startBody.jobId) throw new Error(startBody.error ?? 'Ошибка')

      toast.loading('Разбираю рилз — обычно 30-60 секунд…', { id: t })
      await pollJob(startBody.jobId)
      toast.dismiss(t); toast.success('Рилз разобран и добавлен')
      setUrl(''); setNichesInput(''); await load()
    } catch (e) { toast.dismiss(t); toast.error(e instanceof Error ? e.message : 'Ошибка', { duration: 12000 }) }
    finally { setAdding(false) }
  }

  const remove = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/viral-reels?id=${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setReels(prev => prev.filter(r => r.id !== id))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Ошибка') }
    finally { setBusyId(null) }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Вставь ссылку на залетевший Instagram рилз — AI расшифрует что в нём говорят, разберёт почему он зашёл, и
        {scope === 'system' ? ' добавит его в контент-планы всех пользователей с подходящей нишей.' : ' будет вплетать такой формат в твой контент-план.'}
      </p>

      {needsMigration && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          ⚠️ Таблица виральных рилз не создана. Примени миграцию <b>014_viral_reels.sql</b> в Supabase → SQL Editor.
        </div>
      )}

      {/* Add */}
      <div className="rounded-xl border border-border bg-card p-3.5 space-y-2.5">
        <Input value={url} onChange={e => setUrl(e.target.value)} disabled={adding}
          placeholder="https://instagram.com/reel/..." className="text-sm" />
        {scope === 'system' && (
          <Input value={nichesInput} onChange={e => setNichesInput(e.target.value)} disabled={adding}
            placeholder="Ниши через запятую (пусто = всем): нутрициология, фитнес" className="text-sm" />
        )}
        <Button onClick={add} disabled={adding || !url.trim()} className="w-full gradient-accent text-white">
          {adding ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Разбираю рилз…</> : <><Plus className="h-4 w-4 mr-2" /> Добавить и разобрать</>}
        </Button>
        <p className="text-[11px] text-muted-foreground">Анализ занимает ~30-60 секунд (загрузка + расшифровка + разбор).</p>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : reels.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Рилз-референсов пока нет. Добавь первый выше.</p>
      ) : (
        <div className="space-y-2">
          {reels.map(r => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-3.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Film className="h-3.5 w-3.5 text-primary shrink-0" />{r.reel_type || 'Рилз'}</p>
                  {r.username && <a href={r.source_url} target="_blank" rel="noreferrer" className="text-[11px] text-primary">@{r.username} · открыть</a>}
                </div>
                <button onClick={() => remove(r.id)} disabled={busyId === r.id}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0">
                  {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                {r.views ? <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" />{r.views.toLocaleString('ru-RU')}</span> : null}
                {r.likes ? <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{r.likes.toLocaleString('ru-RU')}</span> : null}
                {r.comments ? <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{r.comments.toLocaleString('ru-RU')}</span> : null}
              </div>
              {r.analysis && <p className="text-xs text-foreground/80 leading-snug flex items-start gap-1.5"><Sparkles className="h-3 w-3 text-primary mt-0.5 shrink-0" />{r.analysis}</p>}
              {r.niches && r.niches.length > 0 && (
                <div className="flex flex-wrap gap-1">{r.niches.map(n => <span key={n} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{n}</span>)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
