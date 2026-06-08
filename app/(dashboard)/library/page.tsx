'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Bookmark, Copy, Check, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SavedContentRow } from '@/lib/saveContent'

// Group order + Russian labels for the content-type sections.
const TYPE_ORDER = ['post', 'carousel', 'reels', 'stories', 'email', 'live', 'other'] as const
const TYPE_LABELS: Record<string, string> = {
  post: 'Посты', carousel: 'Карусели', reels: 'Рилзы', stories: 'Сторис',
  email: 'Письма', live: 'Эфиры', other: 'Из чата и прочее',
}

export default function LibraryPage() {
  const supabase = createClient()
  const [items, setItems] = useState<SavedContentRow[]>([])
  const [projects, setProjects] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    // When opened from a project ("Готовое" tile → /library?project=ID), scope to
    // that project so the user sees this blog's library, not everything.
    const projectFilter = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('project') : null
    const base = supabase.from('saved_content').select('*')
    const scoped = projectFilter ? base.eq('project_id', projectFilter) : base
    const [{ data: rows, error }, { data: projs }] = await Promise.all([
      scoped.order('created_at', { ascending: false }),
      supabase.from('projects').select('id, name'),
    ])
    if (error) {
      if (/relation .*saved_content.* does not exist|could not find the table/i.test(error.message)) setNeedsSetup(true)
      setItems([])
    } else {
      setItems((rows ?? []) as SavedContentRow[])
    }
    setProjects(Object.fromEntries(((projs ?? []) as { id: string; name: string }[]).map(p => [p.id, p.name])))
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const copy = (it: SavedContentRow) => {
    navigator.clipboard?.writeText(it.body).then(() => {
      setCopiedId(it.id); setTimeout(() => setCopiedId(null), 1500)
    }).catch(() => toast.error('Не удалось скопировать'))
  }

  const remove = async (id: string) => {
    setDeletingId(id)
    const { error } = await supabase.from('saved_content').delete().eq('id', id)
    if (error) { toast.error('Не удалось удалить'); setDeletingId(null); return }
    setItems(prev => prev.filter(i => i.id !== id))
    setDeletingId(null)
    toast.success('Удалено')
  }

  const groups = TYPE_ORDER
    .map(key => ({ key, label: TYPE_LABELS[key], rows: items.filter(i => (i.content_type || 'other') === key) }))
    .filter(g => g.rows.length > 0)

  return (
    <div className="p-4 md:p-6 pb-28 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-accent">
          <Bookmark className="h-4.5 w-4.5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground leading-tight">Готовый контент</h1>
          <p className="text-sm text-muted-foreground leading-tight">Сохранённое — бери и публикуй</p>
        </div>
      </div>

      <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 text-sm text-foreground flex items-start gap-2.5">
        <span className="text-base leading-none mt-0.5">🎯</span>
        <p className="leading-snug">
          <b>AI учится на этом контенте.</b> Добавляй сюда свои лучшие посты — и ассистент будет писать твоим голосом.
          Каждый проект учится на своём «Готовом»; данные одного проекта не попадают в другой.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
        </div>
      ) : needsSetup ? (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm text-foreground">
          Библиотека почти готова — осталось применить миграцию БД (таблица <code>saved_content</code>).
          После этого сохранённый контент появится здесь.
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center gap-3 py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
            <Bookmark className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Тут пока пусто</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              Жми «Сохранить» под понравившимся текстом в чате или контент-плане — он появится здесь, разложенный по типам.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <div key={group.key} className="space-y-2.5">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                {group.label}
                <span className="text-[11px] font-medium text-muted-foreground bg-secondary rounded-full px-2 py-0.5">{group.rows.length}</span>
              </h2>
              {group.rows.map(it => (
                <div key={it.id} className="rounded-xl border border-[#ECECEC] bg-white p-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground line-clamp-2 flex-1">{it.title || 'Без названия'}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => copy(it)} title="Копировать"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E8E8E8] text-muted-foreground hover:text-primary transition-colors">
                        {copiedId === it.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => remove(it.id)} disabled={deletingId === it.id} title="Удалить"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E8E8E8] text-muted-foreground hover:text-red-500 hover:border-red-200 transition-colors">
                        {deletingId === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <p className="text-[13px] text-[#444] whitespace-pre-wrap line-clamp-4 leading-relaxed">{it.body}</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {it.project_id && projects[it.project_id] && <span className="truncate">{projects[it.project_id]}</span>}
                    <span className="ml-auto shrink-0">{new Date(it.created_at).toLocaleDateString('ru-RU')}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
