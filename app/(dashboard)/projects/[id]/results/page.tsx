'use client'

import { useState, useEffect, useCallback, use } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowLeftRight, Loader2, TrendingUp, Heart, Eye, Bookmark, Check } from 'lucide-react'
import { toast } from 'sonner'
import { friendlyError } from '@/lib/friendlyError'

interface Item {
  id: string
  source: 'plan' | 'saved'
  content_type: string
  title: string | null
  body_text: string | null
  day_number: number | null
  reach: number | null
  reactions: number | null
  saves: number | null
  published_at: string | null
}

const TYPE_RU: Record<string, string> = { post: 'Пост', reels: 'Рилз', stories: 'Сторис', carousel: 'Карусель', email: 'Email', live: 'Эфир', webinar: 'Вебинар' }

export default function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, { reach: string; reactions: string; saves: string }>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/content/results?projectId=${id}`)
      if (!res.ok) throw new Error()
      const data = await res.json() as { items: Item[] }
      setItems(data.items || [])
      const e: Record<string, { reach: string; reactions: string; saves: string }> = {}
      for (const it of data.items || []) e[`${it.source}:${it.id}`] = { reach: it.reach?.toString() ?? '', reactions: it.reactions?.toString() ?? '', saves: it.saves?.toString() ?? '' }
      setEdits(e)
    } catch { toast.error('Ошибка загрузки') }
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  const save = async (item: Item) => {
    const e = edits[`${item.source}:${item.id}`]
    setSavingId(`${item.source}:${item.id}`)
    try {
      const res = await fetch('/api/content/results', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          source: item.source,
          reach: parseInt(e.reach) || 0,
          reactions: parseInt(e.reactions) || 0,
          saves: parseInt(e.saves) || 0,
          published_at: item.published_at || new Date().toISOString(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setItems(prev => prev.map(x => (x.id === item.id && x.source === item.source) ? { ...x, reach: parseInt(e.reach) || 0, reactions: parseInt(e.reactions) || 0, saves: parseInt(e.saves) || 0 } : x))
      toast.success('Результаты сохранены — AI учтёт что зашло')
    } catch (err) { toast.error(friendlyError(err, 'Ошибка')) }
    finally { setSavingId(null) }
  }

  // Top performers by reactions
  const top = [...items].filter(i => (i.reactions ?? 0) > 0).sort((a, b) => (b.reactions ?? 0) - (a.reactions ?? 0)).slice(0, 3)

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link href={`/projects/${id}`} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-secondary"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Результаты</h1>
          <p className="text-xs text-muted-foreground">Внеси охваты и реакции — AI усилит то, что зашло</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Сгенерированного контента пока нет.
          <div className="mt-3"><Link href={`/projects/${id}/content-plan`} className="text-primary font-medium">Открыть контент-план →</Link></div>
        </div>
      ) : (
        <>
          {top.length > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5">
              <p className="text-xs font-bold text-primary mb-2 flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> Что зашло лучше всего</p>
              <div className="space-y-1.5">
                {top.map((t, i) => (
                  <div key={`${t.source}:${t.id}`} className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-primary">#{i + 1}</span>
                    <span className="flex-1 truncate text-foreground">{t.title || (t.body_text || '').slice(0, 50)}</span>
                    <span className="flex items-center gap-0.5 text-pink-600"><Heart className="h-3 w-3" />{t.reactions}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {items.map(item => {
              const k = `${item.source}:${item.id}`
              const e = edits[k] ?? { reach: '', reactions: '', saves: '' }
              return (
                <div key={k} className="rounded-xl border border-border bg-card p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{TYPE_RU[item.content_type] ?? item.content_type}{item.day_number ? ` · день ${item.day_number}` : ''}{item.source === 'saved' ? ' · Готовое' : ''}</span>
                    <span className="text-sm font-medium text-foreground truncate flex-1">{item.title || (item.body_text || '').slice(0, 40)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'reach', icon: Eye, label: 'Охваты' },
                      { key: 'reactions', icon: Heart, label: 'Реакции' },
                      { key: 'saves', icon: Bookmark, label: 'Сохран.' },
                    ].map(({ key, icon: Icon, label }) => (
                      <div key={key} className="space-y-1">
                        <label className="text-[10px] text-muted-foreground flex items-center gap-1"><Icon className="h-3 w-3" />{label}</label>
                        <input type="number" inputMode="numeric" value={(e as Record<string, string>)[key]}
                          onChange={ev => setEdits(prev => ({ ...prev, [k]: { ...e, [key]: ev.target.value } }))}
                          className="w-full h-9 rounded-lg border border-input bg-background px-2 text-sm" placeholder="0" />
                      </div>
                    ))}
                  </div>
                  <button onClick={() => save(item)} disabled={savingId === k}
                    className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-white gradient-accent rounded-xl py-2">
                    {savingId === k ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Сохранить результаты
                  </button>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Посты с хорошими реакциями автоматически становятся эталоном стиля — следующий контент AI пишет ближе к тому, что у твоей аудитории заходит.
          </p>
        </>
      )}
    </div>
  )
}
